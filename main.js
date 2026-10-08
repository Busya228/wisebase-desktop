// WiseBase CRM — desktop-обёртка (Electron).
//
// Приложение — один статический index.html (веб-версия), рассчитанный на показ
// из настоящего http(s)-источника (там используется Service Worker для офлайн-
// кеша и локальных напоминаний, а Service Worker не работает по протоколу
// file://). Поэтому здесь поднимается локальный HTTP-сервер на 127.0.0.1 и
// окно грузит страницу оттуда — для браузерного движка это обычный "секурный"
// источник (как localhost), и всё, что уже работает в вебе (SW, кеш, уведомления
// Notification API), работает и тут без переделок кода приложения.
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, session, dialog, Notification } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const APP_DIR = path.join(__dirname, 'app');
const ICON_PNG = path.join(__dirname, 'build', 'icon.png');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

let server = null;
let serverPort = 0;
let mainWindow = null;
let tray = null;
let isQuitting = false;

// Локальный статик-сервер: раздаёт файлы из ./app (index.html, sw.js) на
// 127.0.0.1:<свободный_порт>. Порт выбираем автоматически (0 → ОС выдаёт
// свободный), чтобы не конфликтовать с другими приложениями на машине.
function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.join(APP_DIR, urlPath === '/' ? 'index.html' : urlPath);
        // Защита от выхода за пределы папки приложения (path traversal).
        if (!filePath.startsWith(APP_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
        fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found'); }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500); res.end('Server error');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve(serverPort);
    });
    server.on('error', reject);
  });
}

function createWindow() {
  const icon = nativeImage.createFromPath(ICON_PNG);
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'WiseBase CRM',
    icon,
    backgroundColor: '#0F766E',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // Не «усыплять» страницу, когда окно свёрнуто в трей: иначе Chromium
      // замедляет таймеры, realtime-соединение с Supabase рвётся по таймауту
      // пульса, а напоминания о задачах перестают проверяться. С этим флагом
      // данные продолжают обновляться в фоне и окно открывается уже актуальным.
      backgroundThrottling: false,
    },
    show: false,
    autoHideMenuBar: true,
  });
  mainWindow.setMenuBarVisibility(false);
  attachShortcuts(mainWindow.webContents);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Обновление скачалось, пока окно было в трее — спрашиваем при открытии.
  mainWindow.on('show', () => setTimeout(() => promptUpdate(false), 800));
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/index.html`);

  // Ссылки на внешние карты/Telegram/почту (target=_blank в приложении) должны
  // открываться в обычном системном браузере, а не в новом окне Electron.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:|^tel:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Разрешаем запрос на показ уведомлений (Notification API) без диалога —
  // приложение и так спрашивает разрешение внутри своего интерфейса.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'notifications') return callback(true);
    callback(false);
  });

  // Свернуть в трей вместо закрытия — чтобы локальные напоминания о задачах
  // (проверяются раз в 30 секунд внутри страницы) продолжали работать, пока
  // приложение открыто в фоне, а не завершались вместе с закрытием окна.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PNG).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip('WiseBase CRM');
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть WiseBase CRM', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Проверить обновления', click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
}

function createAppMenu() {
  // Windows/Linux: полоску меню «Файл / Правка / Вид / Окно / Справка» над
  // приложением убираем совсем — у CRM свой интерфейс, а «Проверить обновления»
  // есть в трее. Копировать/вставить/отменить (Ctrl+C/V/X/Z/A) в полях ввода
  // работают и без меню — их обрабатывает сам Chromium. Остальные полезные
  // сочетания (F5, масштаб, F11) добавлены вручную в attachShortcuts().
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS: меню там не внутри окна, а в системной строке сверху экрана, и без
  // пункта «Правка» Cmd+C/V в полях ввода не работают — оставляем минимум.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, role: 'appMenu' },
    { label: 'Правка', role: 'editMenu' },
    { label: 'Окно', role: 'windowMenu' },
  ]));
}

// Горячие клавиши, которые раньше давало меню «Вид».
function attachShortcuts(wc) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = input.key;
    let handled = true;
    if (key === 'F5' || (mod && key.toLowerCase() === 'r')) {
      (input.shift ? wc.reloadIgnoringCache() : wc.reload());
    } else if (key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (key === 'F12' || (mod && input.shift && key.toLowerCase() === 'i')) {
      wc.toggleDevTools();
    } else if (mod && (key === '=' || key === '+')) {
      wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    } else if (mod && key === '-') {
      wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    } else if (mod && key === '0') {
      wc.setZoomLevel(0);
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  });
}

// ============================================================
// АВТООБНОВЛЕНИЯ (electron-updater → GitHub Releases)
//
// Как это видит пользователь:
//   1. Вы публикуете новую версию на GitHub (publish-update.bat).
//   2. Приложение у каждого пользователя само замечает её (при запуске и
//      потом каждый час) и тихо скачивает в фоне — работать это не мешает.
//   3. Появляется окно «Доступна новая версия приложения. Обновить?»
//        • «Обновить» — приложение перезапускается уже новой версией
//          (секунд 10). Ничего скачивать и переустанавливать вручную не нужно,
//          все данные и вход в аккаунт сохраняются.
//        • «Позже» — напомним через 4 часа; а если человек просто выйдет из
//          приложения, обновление тихо применится при выходе.
//   Если окно было свёрнуто в трей — вопрос покажется, когда его откроют.
//
// macOS без платной подписи Apple обновляться «на месте» не умеет (система
// запрещает), поэтому там окно предлагает скачать новую версию со страницы
// релиза. Portable-версия Windows не обновляется (нет места установки).
// ============================================================
const RELEASES_URL = 'https://github.com/Busya228/wisebase-desktop/releases/latest';
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;   // проверка раз в час
const REMIND_LATER_MS = 4 * 60 * 60 * 1000;        // «Позже» = напомнить через 4 часа
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
const isMacOS = process.platform === 'darwin';

let updateReady = null;      // Windows: скачанное обновление, ждёт подтверждения
let updateForMac = null;     // macOS: найдено обновление (скачивается вручную)
let promptOpen = false;
let remindAfter = 0;
let manualCheck = false;     // проверку запустили кнопкой → показать результат

autoUpdater.autoDownload = !isMacOS;
autoUpdater.autoInstallOnAppQuit = true;

function updatesSupported() {
  return app.isPackaged && !isPortable;
}

function checkForUpdates(manual) {
  if (!updatesSupported()) {
    if (manual) dialog.showMessageBox({
      message: isPortable
        ? 'Portable-версия не обновляется сама. Установите WiseBase CRM через установщик (WiseBase-CRM-Setup) — дальше обновления будут приходить автоматически.'
        : 'Проверка обновлений доступна только в установленном приложении.',
    });
    return;
  }
  // Обновление уже найдено/скачано — не качаем заново, просто спрашиваем.
  if (updateReady || updateForMac) { promptUpdate(!!manual); return; }
  manualCheck = !!manual;
  autoUpdater.checkForUpdates().catch(() => {});
}

async function promptUpdate(force) {
  const info = updateReady || updateForMac;
  if (!info || promptOpen) return;
  if (!force && Date.now() < remindAfter) return;
  // Окно в трее — спросим, когда пользователь его откроет (см. 'show' ниже).
  if (!mainWindow || !mainWindow.isVisible()) return;

  promptOpen = true;
  const ready = !!updateReady;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Обновление WiseBase CRM',
    message: 'Доступна новая версия приложения. Обновить?',
    detail: ready
      ? `Новая версия: ${info.version} (у вас ${app.getVersion()}).\nПриложение перезапустится примерно за 10 секунд — переустанавливать ничего не нужно, все данные сохранятся.`
      : `Новая версия: ${info.version} (у вас ${app.getVersion()}).\nОткроется страница загрузки — скачайте архив и замените приложение в папке «Программы».`,
    buttons: ready ? ['Обновить', 'Позже'] : ['Скачать', 'Позже'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  promptOpen = false;

  if (response === 0) {
    if (ready) {
      isQuitting = true;
      // isSilent=true — без окон мастера установки (пользователь уже согласился),
      // isForceRunAfter=true — сразу запустить новую версию.
      autoUpdater.quitAndInstall(true, true);
    } else {
      shell.openExternal(RELEASES_URL);
      remindAfter = Date.now() + REMIND_LATER_MS;
    }
  } else {
    remindAfter = Date.now() + REMIND_LATER_MS;
  }
}

autoUpdater.on('update-available', (info) => {
  if (isMacOS) { updateForMac = info; promptUpdate(manualCheck); manualCheck = false; return; }
  if (manualCheck) dialog.showMessageBox(mainWindow, {
    message: `Найдена новая версия ${info.version}. Скачиваю — спрошу, когда будет готово.`,
  });
});

// Полоска прогресса скачивания на значке в панели задач.
autoUpdater.on('download-progress', (p) => {
  if (mainWindow) mainWindow.setProgressBar(Math.max(0, Math.min(1, (p.percent || 0) / 100)));
});

autoUpdater.on('update-not-available', () => {
  if (manualCheck) dialog.showMessageBox(mainWindow, { message: 'У вас установлена последняя версия WiseBase CRM.' });
  manualCheck = false;
});

autoUpdater.on('error', (err) => {
  if (mainWindow) mainWindow.setProgressBar(-1);
  if (manualCheck) dialog.showErrorBox('Не удалось проверить обновления', String((err && err.message) || err));
  manualCheck = false;
});

autoUpdater.on('update-downloaded', (info) => {
  updateReady = info;
  if (mainWindow) mainWindow.setProgressBar(-1);
  if (tray) tray.setToolTip(`WiseBase CRM — доступна версия ${info.version}`);
  promptUpdate(manualCheck);
  manualCheck = false;
});

function startUpdateLoop() {
  if (!updatesSupported()) return;
  setTimeout(() => checkForUpdates(false), 5000);
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS);
}

// Не даём запускать вторую копию приложения — второй экземпляр просто
// переключит фокус на уже открытое окно первого.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (!mainWindow.isVisible()) mainWindow.show(); mainWindow.focus(); }
  });

  // Нужен Windows, чтобы системные уведомления показывались от имени приложения.
  if (process.platform === 'win32') app.setAppUserModelId('com.wisebase.crm');

  app.whenReady().then(async () => {
    await startServer();
    createAppMenu();
    createWindow();
    createTray();
    startUpdateLoop();
  });

  app.on('window-all-closed', () => {
    // На Windows/Linux при полном закрытии (не в трей) — выходим; на macOS
    // принято оставлять процесс в доке, пока пользователь явно не выйдет (Cmd+Q).
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
  });

  app.on('before-quit', () => { isQuitting = true; });
}

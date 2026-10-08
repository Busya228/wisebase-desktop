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

  // После тихого автообновления, запущенного из трея, окно не показываем —
  // приложение просто продолжает работать в трее, как и до обновления.
  let startHidden = false;
  try {
    if (fs.existsSync(START_HIDDEN_FLAG)) { startHidden = true; fs.unlinkSync(START_HIDDEN_FLAG); }
  } catch (_) {}
  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });
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
      // Обновление уже скачано и ждало, пока человек закончит работу —
      // ставим его сейчас, тихо, и перезапускаемся обратно в трей.
      if (updateReady) installUpdateNow(true);
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
// АВТООБНОВЛЕНИЯ (electron-updater → GitHub Releases), без участия пользователя
//
// • Проверка: через 5 сек после запуска и затем каждый час (приложение обычно
//   живёт в трее неделями, поэтому одной проверки при старте мало).
// • Скачивание: в фоне, автоматически.
// • Установка (тихая, без окон инсталлятора):
//     – если окно сейчас скрыто в трее — ставим сразу и перезапускаемся
//       обратно в трей, пользователь ничего не замечает;
//     – если человек сейчас работает в окне — НЕ прерываем его: показываем
//       системное уведомление, а обновление ставится, как только он закроет
//       окно в трей или выйдет из приложения.
// • Portable-версия Windows не умеет обновляться (у неё нет места установки),
//   поэтому для неё проверка отключена.
// ============================================================
const START_HIDDEN_FLAG = path.join(app.getPath('userData'), 'start-hidden.flag');
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
let updateReady = null;      // info о скачанном обновлении, ждущем установки
let manualCheck = false;     // проверку запустили кнопкой из трея → показать результат

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function updatesSupported() {
  return app.isPackaged && !isPortable;
}

function checkForUpdates(manual) {
  if (!updatesSupported()) {
    if (manual) dialog.showMessageBox({
      message: isPortable
        ? 'Portable-версия не обновляется автоматически. Установите WiseBase CRM через установщик (WiseBase-CRM-Setup), чтобы получать обновления сами.'
        : 'Проверка обновлений доступна только в собранном приложении.',
    });
    return;
  }
  if (updateReady) {
    if (manual) installUpdateNow(false);
    return;
  }
  manualCheck = !!manual;
  autoUpdater.checkForUpdates().catch(() => {});
}

// Тихая установка. hidden=true — после перезапуска остаться в трее, не
// открывая окно (пользователь его и не открывал).
function installUpdateNow(hidden) {
  try {
    if (hidden) fs.writeFileSync(START_HIDDEN_FLAG, '1');
  } catch (_) {}
  isQuitting = true;
  // (isSilent=true, isForceRunAfter=true): без окон инсталлятора и с
  // автоматическим запуском новой версии после установки.
  autoUpdater.quitAndInstall(true, true);
}

autoUpdater.on('update-not-available', () => {
  if (manualCheck) dialog.showMessageBox({ message: 'У вас установлена последняя версия WiseBase CRM.' });
  manualCheck = false;
});

autoUpdater.on('error', (err) => {
  if (manualCheck) dialog.showErrorBox('Не удалось проверить обновления', String((err && err.message) || err));
  manualCheck = false;
});

autoUpdater.on('update-downloaded', (info) => {
  updateReady = info;
  manualCheck = false;
  if (!mainWindow || !mainWindow.isVisible()) {
    installUpdateNow(true);
    return;
  }
  if (Notification.isSupported()) {
    const n = new Notification({
      title: `WiseBase CRM ${info.version} готова к установке`,
      body: 'Обновление установится автоматически, когда вы закроете окно. Нажмите, чтобы перезапустить сейчас.',
      icon: ICON_PNG,
    });
    n.on('click', () => installUpdateNow(false));
    n.show();
  }
  if (tray) tray.setToolTip(`WiseBase CRM — обновление ${info.version} готово`);
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

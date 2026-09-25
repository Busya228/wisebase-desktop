// WiseBase CRM — desktop-обёртка (Electron).
//
// Приложение — один статический index.html (веб-версия), рассчитанный на показ
// из настоящего http(s)-источника (там используется Service Worker для офлайн-
// кеша и локальных напоминаний, а Service Worker не работает по протоколу
// file://). Поэтому здесь поднимается локальный HTTP-сервер на 127.0.0.1 и
// окно грузит страницу оттуда — для браузерного движка это обычный "секурный"
// источник (как localhost), и всё, что уже работает в вебе (SW, кеш, уведомления
// Notification API), работает и тут без переделок кода приложения.
const { app, BrowserWindow, Tray, Menu, shell, nativeImage, session, dialog } = require('electron');
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
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
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
  // Полноценное меню Edit нужно на macOS, чтобы работали стандартные сочетания
  // клавиш (Cmd+C/V/X/A/Z) в текстовых полях приложения — без ролей copy/paste/…
  // в меню Chromium на Mac их не обрабатывает.
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, role: 'appMenu' }] : []),
    {
      label: 'Файл',
      submenu: [isMac ? { role: 'close' } : { role: 'quit', label: 'Выход' }],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'forceReload', label: 'Жёстко обновить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Обычный размер' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
      ],
    },
    {
      label: 'Окно',
      submenu: [{ role: 'minimize', label: 'Свернуть' }, { role: 'zoom', label: 'Развернуть' }],
    },
    {
      label: 'Справка',
      submenu: [{ label: 'Проверить обновления', click: () => checkForUpdates(true) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============================================================
// АВТООБНОВЛЕНИЯ (electron-updater → GitHub Releases)
// Источник обновлений задан в build-конфиге package.json (publish.provider:
// "github"). electron-builder при публикации релиза (--publish always)
// прикладывает к GitHub Release файлы latest.yml/latest-mac.yml — их и читает
// autoUpdater, чтобы понять, есть ли версия новее текущей.
// Тихая проверка при старте — не мешает пользователю, если обновлений нет;
// если найдены — скачивает в фоне и предлагает перезапустить.
// silent=true (по клику из меню/трея) показывает результат явным диалогом,
// даже если обновлений нет — иначе пользователь не поймёт, сработала ли кнопка.
// ============================================================
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function checkForUpdates(manual) {
  if (!app.isPackaged) {
    if (manual) dialog.showMessageBox({ message: 'Проверка обновлений доступна только в собранном приложении.' });
    return;
  }
  autoUpdater.checkForUpdates().catch(err => {
    if (manual) dialog.showErrorBox('Не удалось проверить обновления', String(err && err.message || err));
  });
  if (manual) _manualCheckPending = true;
}
let _manualCheckPending = false;

autoUpdater.on('update-not-available', () => {
  if (_manualCheckPending) {
    dialog.showMessageBox({ message: 'У вас установлена последняя версия WiseBase CRM.' });
    _manualCheckPending = false;
  }
});
autoUpdater.on('error', (err) => {
  if (_manualCheckPending) {
    dialog.showErrorBox('Ошибка проверки обновлений', String(err && err.message || err));
    _manualCheckPending = false;
  }
});
autoUpdater.on('update-downloaded', (info) => {
  _manualCheckPending = false;
  dialog.showMessageBox({
    type: 'info',
    buttons: ['Перезапустить сейчас', 'Позже'],
    defaultId: 0,
    message: `Доступна новая версия WiseBase CRM ${info.version}`,
    detail: 'Обновление скачано. Перезапустить приложение сейчас, чтобы применить его?',
  }).then(({ response }) => {
    if (response === 0) { isQuitting = true; autoUpdater.quitAndInstall(); }
  });
});

// Не даём запускать вторую копию приложения — второй экземпляр просто
// переключит фокус на уже открытое окно первого.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (!mainWindow.isVisible()) mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    await startServer();
    createAppMenu();
    createWindow();
    createTray();
    // Проверяем обновления через пару секунд после старта — не блокируя
    // открытие окна и не мешая начальной загрузке приложения.
    setTimeout(() => checkForUpdates(false), 3000);
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

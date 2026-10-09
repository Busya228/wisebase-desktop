// Мост между страницей CRM и десктоп-обёрткой (Electron).
// Странице доступен только этот ограниченный набор действий — без доступа к
// файлам, Node.js и т.п. (contextIsolation + sandbox остаются включены).
// В браузере этого объекта нет, поэтому раздел «Приложение» в настройках
// показывается только в десктоп-версии.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wisebaseDesktop', {
  isDesktop: true,
  action: (name) => ipcRenderer.invoke('wb:action', String(name)),
  info: () => ipcRenderer.invoke('wb:info'),
  // Подписка на смену состояния окна (полный экран / развёрнуто).
  onState: (cb) => ipcRenderer.on('wb:state', (_e, state) => { try { cb(state); } catch (_) {} }),
});

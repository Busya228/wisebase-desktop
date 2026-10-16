// Десктоп-обёртка (main.js) без запуска Electron: подменяем модуль electron
// заглушкой и проверяем локальный сервер —
//   • порт постоянный (иначе при каждом запуске терялись вход и localStorage);
//   • если порт занят — берётся следующий, выбор запоминается;
//   • нельзя прочитать файлы за пределами папки app/;
//   • ответы не кешируются движком (после обновления — свежий index.html).
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const http = require("http");
const { assert } = require("./_helpers.js");

const ROOT = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wb-main-"));
const userData = path.join(tmp, "userData");
fs.mkdirSync(path.join(tmp, "node_modules", "electron"), { recursive: true });
fs.mkdirSync(path.join(tmp, "node_modules", "electron-updater"), { recursive: true });
fs.mkdirSync(userData);
fs.writeFileSync(path.join(tmp, "node_modules", "electron", "index.js"), `
const noop=()=>{};
module.exports={app:{getPath:()=>${JSON.stringify(userData)},requestSingleInstanceLock:()=>false,quit:noop,on:noop,
  whenReady:()=>new Promise(()=>{}),isPackaged:false,getVersion:()=>'0',setAppUserModelId:noop},
  BrowserWindow:function(){},Tray:function(){},Menu:{},shell:{},nativeImage:{},session:{},dialog:{},ipcMain:{handle:noop}};`);
fs.writeFileSync(path.join(tmp, "node_modules", "electron-updater", "index.js"), "module.exports={autoUpdater:{on(){}}};");
let src = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
assert(/const gotLock = app\.requestSingleInstanceLock\(\);/.test(src), "main.js: точка входа найдена");
src = src.replace("const gotLock = app.requestSingleInstanceLock();", "module.exports={startServer,getPort:()=>serverPort};\nconst gotLock = app.requestSingleInstanceLock();");
fs.writeFileSync(path.join(tmp, "main.js"), src);
fs.mkdirSync(path.join(tmp, "app"));
fs.writeFileSync(path.join(tmp, "app", "index.html"), "INDEX");
fs.mkdirSync(path.join(tmp, "app-secret"));
fs.writeFileSync(path.join(tmp, "app-secret", "x.txt"), "SECRET");

const get = (port, u) => new Promise(r => http.get({ host: "127.0.0.1", port, path: u }, res => {
  let d = ""; res.on("data", c => d += c); res.on("end", () => r({ status: res.statusCode, body: d, cc: res.headers["cache-control"] }));
}).on("error", e => r({ status: 0, body: e.message })));

(async () => {
  assert(!/listen\(0, '127\.0\.0\.1'/.test(fs.readFileSync(path.join(ROOT, "main.js"), "utf8")), "main.js больше не берёт случайный порт при каждом запуске");
  // Занимаем первый «любимый» порт — сервер должен взять следующий.
  const blocker = await new Promise(r => { const s = net.createServer(); s.once("error", () => r(null)); s.listen(47329, "127.0.0.1", () => r(s)); });
  const m = require(path.join(tmp, "main.js"));
  const port = await m.startServer();
  assert(port >= 47329 && port <= 47333 && (!blocker || port !== 47329), "порт из постоянного списка, занятый пропущен: " + port);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, "desktop-settings.json"), "utf8"));
  assert(saved.port === port, "выбранный порт сохранён для следующих запусков: " + JSON.stringify(saved));

  const idx = await get(port, "/");
  assert(idx.status === 200 && idx.body === "INDEX", "главная страница отдаётся");
  assert(idx.cc === "no-cache", "Cache-Control: no-cache — после обновления не будет старого index.html");
  for (const u of ["/../app-secret/x.txt", "/..%2fapp-secret/x.txt", "/%2e%2e/app-secret/x.txt", "/..%5capp-secret%5cx.txt"]) {
    const r = await get(port, u);
    assert(r.body !== "SECRET", "файл за пределами app/ недоступен: " + u + " → " + r.status);
  }
  const foreignHost = await new Promise(r => http.get({host:'127.0.0.1',port,path:'/',headers:{Host:'invalid.test'}}, res=>{res.resume();res.on('end',()=>r(res.statusCode));}).on('error',()=>r(0)));
  assert(foreignHost===403,'локальный сервер отклоняет неверный Host');
  if (blocker) blocker.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

// Раздел «🖥️ Приложение» в Настройках: виден только в десктоп-версии (когда
// preload.js выставил window.wisebaseDesktop), кнопки вызывают действия обёртки,
// состояние окна (масштаб, полный экран, версия) отображается.
const { openApp, launch, assert } = require("./_helpers.js");

const MOCK = `
window.__deskCalls = [];
window.__deskState = { version: '29.1.5', zoom: 100, fullscreen: false, maximized: false, windowMode: 'windowed', platform: 'win32', updatesSupported: true, portable: false };
window.wisebaseDesktop = {
  isDesktop: true,
  info: async () => Object.assign({}, window.__deskState),
  action: async (name) => {
    window.__deskCalls.push(name);
    if (name === 'zoomIn') window.__deskState.zoom = 120;
    if (name === 'setFullscreen') window.__deskState.fullscreen = true;
    if (name === 'setWindowed') window.__deskState.fullscreen = false;
    return Object.assign({}, window.__deskState);
  },
  onState: (cb) => { window.__deskPush = cb; },
};`;

(async () => {
  // --- Браузер (без обёртки): раздела нет ---
  {
    const { browser, page, errors } = await launch({ stub: true });
    await openApp(page);
    const hidden = await page.evaluate(() => { openSettings(); return document.getElementById("set-desktop-wrap").style.display; });
    assert(hidden === "none", "в браузере раздел «Приложение» скрыт");
    assert(errors.length === 0, "браузер: нет JS-ошибок: " + JSON.stringify(errors));
    await browser.close();
  }
  // --- Десктоп: раздел виден и управляет окном ---
  const { browser, page, errors } = await launch({ stub: true, init: MOCK });
  await openApp(page);
  await page.evaluate(() => openSettings());
  await page.waitForTimeout(200);
  const s1 = await page.evaluate(() => ({
    shown: document.getElementById("set-desktop-wrap").style.display,
    version: document.getElementById("desk-version")?.textContent,
    zoom: document.getElementById("desk-zoom")?.textContent,
  }));
  assert(s1.shown === "", "в десктоп-версии раздел «Приложение» виден");
  assert(/29\.1\.5/.test(s1.version || ""), "показана версия приложения: " + s1.version);
  assert(s1.zoom === "100%", "показан масштаб: " + s1.zoom);

  await page.evaluate(() => desktopAction("zoomIn"));
  await page.waitForTimeout(100);
  const z = await page.evaluate(() => ({ zoom: document.getElementById("desk-zoom").textContent, calls: window.__deskCalls.slice() }));
  assert(z.calls.includes("zoomIn") && z.zoom === "120%", "кнопка масштаба вызывает обёртку и обновляет подпись: " + JSON.stringify(z));

  await page.evaluate(() => setDesktopWindowMode("fullscreen"));
  await page.waitForTimeout(600);
  const fs = await page.evaluate(() => ({ cls: document.documentElement.classList.contains("desk-fullscreen"), sel: document.getElementById("desk-winmode")?.value, bar: !!document.getElementById("desk-fs-bar") }));
  assert(fs.cls && fs.sel === "fullscreen" && fs.bar, "режим «Полный экран»: класс, выбор в настройке и панель управления окном: " + JSON.stringify(fs));

  // Смена режима снаружи (F11) приходит через onState
  await page.evaluate(() => window.__deskPush(Object.assign({}, window.__deskState, { fullscreen: false })));
  const back = await page.evaluate(() => ({ cls: document.documentElement.classList.contains("desk-fullscreen"), sel: document.getElementById("desk-winmode")?.value }));
  assert(!back.cls && back.sel === "windowed", "выход из полного экрана по F11 отражается в настройке: " + JSON.stringify(back));

  // «Выход» спрашивает подтверждение; отказ — ничего не делает
  page.once("dialog", d => d.dismiss());
  await page.evaluate(() => desktopAction("quit"));
  const q = await page.evaluate(() => window.__deskCalls.includes("quit"));
  assert(!q, "«Выйти» без подтверждения не закрывает приложение");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

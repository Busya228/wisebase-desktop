// Проверяет, что клиентская инфраструктура push-уведомлений на месте:
// регистрация service worker, VAPID-ключ и функция подписки.
const { openApp, launch, assert } = require("./_helpers.js");
const fs = require("fs");
const path = require("path");

(async () => {
  const { browser, page, errors } = await launch();
  await openApp(page);
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => ({
    hasVapidKey: typeof PUSH_VAPID_PUBLIC_KEY === "string" && PUSH_VAPID_PUBLIC_KEY.length > 40,
    hasSubscribeFn: typeof subscribeToPush === "function",
    hasEnableFn: typeof enableBrowserNotifications === "function",
    swSupported: "serviceWorker" in navigator,
  }));
  assert(info.hasVapidKey, "PUSH_VAPID_PUBLIC_KEY задан");
  assert(info.hasSubscribeFn, "subscribeToPush() определена");
  assert(info.hasEnableFn, "enableBrowserNotifications() определена");

  const swPath = path.resolve(__dirname, "../sw.js");
  const swSrc = fs.readFileSync(swPath, "utf8");
  assert(/addEventListener\(['"]push['"]/.test(swSrc), "sw.js обрабатывает событие push");
  assert(/addEventListener\(['"]notificationclick['"]/.test(swSrc), "sw.js обрабатывает клик по уведомлению");

  const pushServerDir = path.resolve(__dirname, "../push-server");
  assert(fs.existsSync(path.join(pushServerDir, "crm-push", "index.ts")), "есть серверная функция push-server/crm-push/index.ts");
  assert(fs.existsSync(path.join(pushServerDir, "push_schema.sql")), "есть push_schema.sql");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

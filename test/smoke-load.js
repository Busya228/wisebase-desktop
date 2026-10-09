// Проверяет, что приложение открывается без JS-ошибок и показывает дашборд.
const { openApp, launch, assert } = require("./_helpers.js");
(async () => {
  const { browser, page, errors } = await launch();
  await openApp(page);
  const info = await page.evaluate(() => ({
    hasApp: !!document.getElementById("app-root"),
    dashboardVisible: !!document.querySelector("#page-dashboard.active"),
    title: document.title,
    build: typeof APP_BUILD !== "undefined" ? APP_BUILD : null,
  }));
  assert(info.hasApp, "app-root существует");
  assert(info.dashboardVisible, "дашборд активен после загрузки");
  assert(!!info.build, "APP_BUILD определён: " + info.build);
  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

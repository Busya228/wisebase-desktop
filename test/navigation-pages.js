// Проверяет переключение между основными разделами приложения.
const { openApp, launch, assert } = require("./_helpers.js");
const PAGES = ["dashboard", "clients", "tasks", "links", "calendar", "analytics"];
(async () => {
  const { browser, page, errors } = await launch();
  await openApp(page);
  for (const name of PAGES) {
    await page.evaluate(p => { try { showPage(p); } catch (e) {} }, name);
    await page.waitForTimeout(150);
    const active = await page.evaluate(p => !!document.querySelector("#page-" + p + ".active"), name);
    assert(active, "страница '" + name + "' становится активной");
  }
  assert(errors.length === 0, "нет JS-ошибок при навигации: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

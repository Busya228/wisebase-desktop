// Проверяет, что приложение регистрирует манифест PWA и иконки для установки.
const { openApp, launch, assert } = require("./_helpers.js");
(async () => {
  const { browser, page, errors } = await launch();
  await openApp(page);
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    const themeColor = document.querySelector('meta[name="theme-color"]');
    return {
      hasManifest: !!(manifestLink && manifestLink.href),
      manifestHref: manifestLink ? manifestLink.href.slice(0, 30) : null,
      hasAppleIcon: !!appleIcon,
      hasThemeColor: !!themeColor,
    };
  });
  assert(info.hasManifest, "<link rel=manifest> подключён (" + info.manifestHref + "...)");
  assert(info.hasAppleIcon, "apple-touch-icon подключена (для установки на iOS)");
  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

// Проверяет сворачивание разделов детальной карточки клиента (Информация,
// Контакты, Предложения, Активность) — состояние общее на все карточки и
// переживает переключение между клиентами.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  await page.evaluate(() => {
    currentUser = { id: "u1", email: "test@test.ru" };
    currentProfile = { id: "u1", role: "admin", full_name: "Тест" };
    S.clients.push({ id: 1, name: "Тест", company: "ООО Тест", status: "active", owner_id: "u1", avatar: "Т", color: "c1", tags: [], history: [{ date: today(), text: "Визит" }] });
    S.offers.push({ id: 1, clientId: 1, text: "Предложение X", status: "proposed", amount: 5000, channel: "ФМА" });
    localInit();
    showPage("clients");
    selectClient(1);
  });

  const r0 = await page.evaluate(() => getComputedStyle(document.querySelector(".info-g")).display);
  assert(r0 !== "none", "по умолчанию раздел «Информация» развёрнут");

  const r1 = await page.evaluate(() => {
    [...document.querySelectorAll(".detail-sec-hd")].find(el => el.textContent.includes("Информация")).click();
    return getComputedStyle(document.querySelector(".info-g")).display;
  });
  assert(r1 === "none", "клик по заголовку сворачивает раздел");

  const r2 = await page.evaluate(() => {
    S.clients.push({ id: 2, name: "Второй", company: "ООО Второй", status: "active", owner_id: "u1", avatar: "В", color: "c2", tags: [], history: [] });
    renderClients();
    selectClient(2);
    return getComputedStyle(document.querySelector(".info-g")).display;
  });
  assert(r2 === "none", "свёрнутость — общая настройка, сохраняется при переходе к другому клиенту");

  const r3 = await page.evaluate(() => {
    selectClient(1);
    const btn = [...document.querySelectorAll(".client-detail-wrap button")].find(b => b.textContent.includes("+ Предложение"));
    return !!btn && btn.getAttribute("onclick").includes("openAddOffer");
  });
  assert(r3, "кнопка «+ Предложение» в заголовке раздела предложений остаётся отдельно кликабельной");

  const r4 = await page.evaluate(() => {
    [...document.querySelectorAll(".detail-sec-hd")].find(el => el.textContent.includes("Информация")).click();
    return getComputedStyle(document.querySelector(".info-g")).display;
  });
  assert(r4 !== "none", "повторный клик разворачивает раздел обратно");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

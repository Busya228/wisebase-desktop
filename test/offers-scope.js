// Проверяет, что раздел «Предложения» показывает только клиентов и сделки самого
// пользователя (как в «Клиентах»), а не всей команды — включая фильтр вверху,
// счётчик «Клиентов: N», список самих предложений и форму создания/редактирования.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  await page.evaluate(() => {
    currentUser = { id: "u1" };
    currentProfile = { id: "u1", role: "manager" };
    delegatedFrom = new Set();
    for (let i = 1; i <= 6; i++) S.clients.push({ id: i, name: "Мой " + i, company: "ООО М" + i, status: "active", owner_id: "u1", tags: [], history: [] });
    for (let i = 7; i <= 53; i++) S.clients.push({ id: i, name: "Чужой " + i, company: "ООО Ч" + i, status: "active", owner_id: "u2", tags: [], history: [] });
    S.offers.push({ id: 1, clientId: 1, text: "Моё предложение", status: "proposed", amount: 1000, channel: "ФМА" });
    S.offers.push({ id: 2, clientId: 7, text: "Чужое предложение", status: "proposed", amount: 2000, channel: "ФМА" });
    localInit();
    showPage("offers");
  });

  const r = await page.evaluate(() => ({
    dropdownOptions: document.getElementById("offer-client-filter").options.length - 1,
    sumText: document.getElementById("offer-sum").textContent,
    visibleOfferRows: document.querySelectorAll(".deal-row").length,
  }));
  assert(r.dropdownOptions === 6, "фильтр по клиенту показывает только своих (6), не всю базу: " + r.dropdownOptions);
  assert(r.sumText.includes("Клиентов: 6"), "счётчик показывает 6, не 53: " + r.sumText);
  assert(r.visibleOfferRows === 1, "видно только своё предложение, чужое скрыто: " + r.visibleOfferRows);

  const r2 = await page.evaluate(() => { openAddOffer(); return document.getElementById("o-client").options.length; });
  assert(r2 === 6, "форма создания предложения предлагает только своих клиентов: " + r2);

  // Редактирование предложения ЧУЖОГО клиента (например, старые данные или клиент
  // сменил ответственного) не должно молча остаться без выбранного значения —
  // иначе при сохранении предложение тихо переехало бы на первого клиента в списке.
  const r3 = await page.evaluate(() => {
    openEditOffer(2);
    return { value: document.getElementById("o-client").value, optionsCount: document.getElementById("o-client").options.length };
  });
  assert(r3.value === "7", "при редактировании чужого предложения его клиент всё равно выбран, не потерян: " + r3.value);
  assert(r3.optionsCount === 7, "этот клиент добавлен в список отдельно, к обычным 6 своим: " + r3.optionsCount);

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

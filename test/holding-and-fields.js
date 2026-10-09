// Проверяет три новые возможности карточки клиента:
// 1) объединение разных юр. лиц в один холдинг (поиск, слияние, разъединение,
//    корректное слияние двух уже существующих групп),
// 2) сайт и дополнительные ссылки (несколько строк подпись+URL),
// 3) отсрочка платежа (дни) и кредитный лимит (число, не строка с пробелами).
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  await page.evaluate(() => {
    currentUser = { id: "u1", email: "test@test.ru" };
    currentProfile = { id: "u1", role: "admin", full_name: "Тест" };
    S.clients.push({ id: 1, name: "", company: 'ООО "Адонис"', status: "active", owner_id: "u1", avatar: "А", color: "c1", tags: [], history: [] });
    S.clients.push({ id: 2, name: "Уткин Андрей Иванович", company: "ИП Уткин Андрей Иванович", status: "active", owner_id: "u1", avatar: "У", color: "c2", tags: [], history: [] });
    S.clients.push({ id: 3, name: "", company: "ООО Другой", status: "active", owner_id: "u1", avatar: "Д", color: "c3", tags: [], history: [] });
    localInit();
    showPage("clients");
    selectClient(1);
  });

  // --- Холдинг ---
  const h1 = await page.evaluate(() => !!document.querySelector('.client-detail-wrap button[onclick*="openHoldingSearch(1)"]'));
  assert(h1, "кнопка «Объединить с другим юр. лицом» видна у клиента без холдинга");

  const h2 = await page.evaluate(() => {
    openHoldingSearch(1);
    document.getElementById("holding-search-input").value = "Уткин";
    renderHoldingSearchResults();
    return [...document.querySelectorAll("#holding-search-results .cn")].map(el => el.textContent);
  });
  assert(JSON.stringify(h2) === JSON.stringify(["ИП Уткин Андрей Иванович"]), "поиск находит нужное юр. лицо по названию: " + JSON.stringify(h2));

  const h3 = await page.evaluate(async () => {
    await linkClientToHolding(1, 2);
    await new Promise(r => setTimeout(r, 200));
    return { c1: S.clients.find(c => c.id === 1).holdingId, c2: S.clients.find(c => c.id === 2).holdingId };
  });
  assert(h3.c1 && h3.c1 === h3.c2, "оба клиента получили один и тот же holdingId: " + JSON.stringify(h3));

  const h4 = await page.evaluate(() => {
    const html = document.querySelector(".client-detail-wrap")?.innerHTML || "";
    return { hasUtkin: html.includes("Уткин"), hasCount: html.includes("2 юр. лица") };
  });
  assert(h4.hasUtkin && h4.hasCount, "вторая сторона холдинга видна на карточке сразу после объединения");

  const h5 = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".client-detail-wrap .contact-item")].find(el => el.textContent.includes("Уткин"));
    item.click();
    return activeClient;
  });
  assert(h5 === 2, "клик по участнику холдинга переключает карточку на него: " + h5);

  const h6 = await page.evaluate(async () => {
    await linkClientToHolding(3, 1);
    await new Promise(r => setTimeout(r, 200));
    return S.clients.filter(c => c.holdingId === S.clients.find(x => x.id === 1).holdingId).map(c => c.id).sort();
  });
  assert(JSON.stringify(h6) === JSON.stringify([1, 2, 3]), "присоединение к уже существующей группе добавляет, а не создаёт новую: " + JSON.stringify(h6));

  const h7 = await page.evaluate(async () => {
    await unlinkFromHolding(3);
    await new Promise(r => setTimeout(r, 200));
    return { c3: S.clients.find(c => c.id === 3).holdingId, remaining: S.clients.filter(c => c.holdingId).length };
  });
  assert(h7.c3 === null, "исключённый клиент теряет holdingId");
  assert(h7.remaining === 2, "оставшиеся двое по-прежнему в группе: " + h7.remaining);

  // --- Сайт и ссылки ---
  const w1 = await page.evaluate(async () => {
    openAddClient();
    document.getElementById("c-company").value = "Тест Ссылки";
    addWebsiteRow();
    const firstLabel = document.querySelector("#c-web-list .c-web-label").value;
    document.querySelector("#c-web-list .c-web-url").value = "https://relax-t.ru";
    addWebsiteRow();
    const rows = document.querySelectorAll("#c-web-list .ct-extra-row");
    rows[1].querySelector(".c-web-label").value = "ВК";
    rows[1].querySelector(".c-web-url").value = "vk.com/relaxt";
    await saveClientToDb();
    await new Promise(r => setTimeout(r, 200));
    return { firstLabel, websites: S.clients[S.clients.length - 1].websites };
  });
  assert(w1.firstLabel === "Сайт", "первая строка ссылок автоматически подписана «Сайт»");
  assert(JSON.stringify(w1.websites) === JSON.stringify([{ label: "Сайт", url: "https://relax-t.ru" }, { label: "ВК", url: "https://vk.com/relaxt" }]),
    "сайт и ВК сохранены каждый со своей подписью, URL нормализован: " + JSON.stringify(w1.websites));

  const w2 = await page.evaluate(() => {
    const c = S.clients[S.clients.length - 1];
    selectClient(c.id);
    const links = [...document.querySelectorAll(".client-detail-wrap a[target=\"_blank\"]")].filter(a => a.href.includes("relax") || a.href.includes("vk.com"));
    return links.map(a => a.textContent);
  });
  assert(w2.includes("Сайт") && w2.includes("ВК"), "обе ссылки кликабельны на карточке: " + JSON.stringify(w2));

  // --- Отсрочка платежа и кредитный лимит ---
  const p1 = await page.evaluate(async () => {
    openAddClient();
    document.getElementById("c-company").value = "Тест Оплата";
    document.getElementById("c-paydelay").value = "14";
    document.getElementById("c-creditlimit").value = "500000";
    formatAmountInput(document.getElementById("c-creditlimit"));
    await saveClientToDb();
    await new Promise(r => setTimeout(r, 200));
    const c = S.clients[S.clients.length - 1];
    return { paymentDelayDays: c.paymentDelayDays, creditLimit: c.creditLimit, creditLimitType: typeof c.creditLimit };
  });
  assert(p1.paymentDelayDays === 14, "отсрочка платежа сохранена как число дней: " + p1.paymentDelayDays);
  assert(p1.creditLimit === 500000 && p1.creditLimitType === "number", "кредитный лимит сохранён как чистое число, не строка с пробелами: " + JSON.stringify(p1));

  const p2 = await page.evaluate(() => {
    const c = S.clients[S.clients.length - 1];
    editClient(c.id);
    return { paydelay: document.getElementById("c-paydelay").value, creditlimit: document.getElementById("c-creditlimit").value };
  });
  assert(p2.paydelay === "14" && p2.creditlimit === "500\u00A0000", "оба поля корректно подгружаются при повторном редактировании: " + JSON.stringify(p2));

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

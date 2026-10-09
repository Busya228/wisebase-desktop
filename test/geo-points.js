// Проверяет объединённую систему точек клиента («Салоны / точки продаж»):
// раньше это были два независимых списка (геоссылки — только для канала ФМА,
// и отдельно доп. адреса без ссылок), теперь одна точка = город+адрес+2ГИС+Яндекс,
// доступна всем клиентам, и корректно сливает старые данные при миграции.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  await page.evaluate(() => {
    currentUser = { id: "u1", email: "test@test.ru" };
    currentProfile = { id: "u1", role: "admin", full_name: "Тест" };
  });

  const r0 = await page.evaluate(() => { openAddClient(); return getComputedStyle(document.getElementById("c-geo-block")).display; });
  assert(r0 !== "none", "блок точек виден без выбора канала ФМА (ограничение снято)");

  const r1 = await page.evaluate(async () => {
    document.getElementById("c-company").value = "Сеть салонов";
    addGeoGroup();
    const groups = document.querySelectorAll(".geo-group");
    groups[0].querySelector(".geo-city").value = "Пермь";
    groups[0].querySelector(".geo-addr").value = "Ленина, 1";
    groups[0].querySelector(".geo-2gis").value = "https://2gis.ru/perm/1";
    groups[1].querySelector(".geo-city").value = "Березники";
    groups[1].querySelector(".geo-addr").value = "Советская, 5";
    groups[1].querySelector(".geo-ymaps").value = "https://yandex.ru/maps/berez";
    await saveClientToDb();
    await new Promise(r => setTimeout(r, 200));
    return S.clients[S.clients.length - 1].geoLinks;
  });
  assert(JSON.stringify(r1) === JSON.stringify([
    { city: "Пермь", address: "Ленина, 1", map2gis: "https://2gis.ru/perm/1", mapYandex: "" },
    { city: "Березники", address: "Советская, 5", map2gis: "", mapYandex: "https://yandex.ru/maps/berez" },
  ]), "город, адрес и ссылки сохраняются вместе в одной точке: " + JSON.stringify(r1));

  const r2 = await page.evaluate(() => {
    const c = S.clients[S.clients.length - 1];
    selectClient(c.id);
    const html = document.querySelector(".client-detail-wrap")?.innerHTML || "";
    return { hasPerm: html.includes("Пермь") && html.includes("Ленина, 1"), hasBerezniki: html.includes("Березники") && html.includes("Советская, 5") };
  });
  assert(r2.hasPerm && r2.hasBerezniki, "на карточке видно, к какому салону какие данные относятся");

  // Критичный сценарий: старые данные (geoLinks без адреса + extraAddresses без ссылок,
  // тот же город) должны слиться в ОДНУ точку при открытии на редактирование —
  // а не остаться двумя дублирующими друг друга.
  const r3 = await page.evaluate(() => {
    const c = S.clients[S.clients.length - 1];
    c.geoLinks = [{ city: "Соликамск", map2gis: "https://2gis.ru/solikamsk" }];
    c.extraAddresses = [{ city: "Соликамск", address: "Советская, 10" }];
    editClient(c.id);
    const groups = document.querySelectorAll(".geo-group");
    if (groups.length !== 1) return { groupsCount: groups.length };
    return { city: groups[0].querySelector(".geo-city").value, addr: groups[0].querySelector(".geo-addr").value, gis: groups[0].querySelector(".geo-2gis").value };
  });
  assert(r3.city === "Соликамск" && r3.addr === "Советская, 10" && r3.gis === "https://2gis.ru/solikamsk",
    "старые geoLinks и extraAddresses с одним городом сливаются в одну точку: " + JSON.stringify(r3));

  // Несовпадающие по городу старые данные не должны слипаться в одну точку.
  const r4 = await page.evaluate(() => {
    const c = S.clients[S.clients.length - 1];
    c.geoLinks = [{ city: "Кунгур", map2gis: "https://2gis.ru/kungur" }];
    c.extraAddresses = ["Старая строка без города"]; // легаси-формат, просто строка
    editClient(c.id);
    return document.querySelectorAll(".geo-group").length;
  });
  assert(r4 === 2, "несовпадающие старые точки остаются раздельными, ничего не потеряно: " + r4);

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

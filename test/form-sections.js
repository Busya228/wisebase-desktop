// Проверяет, что «Повторить визит», «Теги» и «Заметка» в форме клиента — теперь
// три отдельных сворачиваемых блока (не один общий «Добавить подробности»),
// каждый со своим состоянием, которое запоминается между открытиями формы.
// Отдельно проверяет реальный баг, который тут был: открытие формы «Новый клиент»
// на десктопе падало с ошибкой (вызывался несуществующий элемент).
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  await page.evaluate(() => {
    currentUser = { id: "u1", email: "test@test.ru" };
    currentProfile = { id: "u1", role: "admin", full_name: "Тест" };
  });

  const r0 = await page.evaluate(() => { openAddClient(); return document.getElementById("m-client").classList.contains("open"); });
  assert(r0, "форма «Новый клиент» открывается без ошибки (раньше падала на десктопе)");

  const r1 = await page.evaluate(() => ({
    revisit: getComputedStyle(document.getElementById("cf-revisit-body")).display,
    tags: getComputedStyle(document.getElementById("cf-tags-body")).display,
    note: getComputedStyle(document.getElementById("cf-note-body")).display,
  }));
  assert(r1.revisit !== "none" && r1.tags !== "none" && r1.note !== "none", "все три раздела развёрнуты по умолчанию: " + JSON.stringify(r1));

  const r2 = await page.evaluate(() => { toggleFormSection("note"); return getComputedStyle(document.getElementById("cf-note-body")).display; });
  assert(r2 === "none", "клик по заголовку «Заметка» сворачивает именно этот раздел, не остальные");

  const r3 = await page.evaluate(() => ({
    revisit: getComputedStyle(document.getElementById("cf-revisit-body")).display,
    tags: getComputedStyle(document.getElementById("cf-tags-body")).display,
  }));
  assert(r3.revisit !== "none" && r3.tags !== "none", "остальные два раздела не задеты сворачиванием третьего");

  const r4 = await page.evaluate(() => {
    cancelClientModal();
    openAddClient();
    return getComputedStyle(document.getElementById("cf-note-body")).display;
  });
  assert(r4 === "none", "состояние свёрнутости сохраняется между открытиями формы");

  const r5 = await page.evaluate(async () => {
    document.getElementById("c-company").value = "Тест Компания";
    document.getElementById("c-revisit").value = "6m";
    document.querySelector('#tag-selector input[value="vip"]').checked = true;
    await saveClientToDb();
    await new Promise(r => setTimeout(r, 200));
    const c = S.clients[S.clients.length - 1];
    return { revisit: c.revisitCadence, tags: c.tags };
  });
  assert(r5.revisit === "6m", "поле «Повторить визит» из своего раздела сохраняется корректно");
  assert(JSON.stringify(r5.tags) === JSON.stringify(["vip"]), "теги из своего раздела сохраняются корректно");

  // --- Пять новых сворачиваемых разделов: Контакты, Адрес, Продажи, Салоны, Сайт (уже
  // проверялся частично раньше — здесь по умолчанию/независимости/персистентности) ---
  const r6 = await page.evaluate(() => {
    openAddClient();
    const keys = ["contacts", "address", "sales", "salons", "web"];
    return keys.map(k => getComputedStyle(document.getElementById("cf-" + k + "-body")).display);
  });
  assert(r6.every(d => d !== "none"), "все пять новых разделов развёрнуты по умолчанию: " + JSON.stringify(r6));

  const r7 = await page.evaluate(() => {
    toggleFormSection("address");
    return {
      address: getComputedStyle(document.getElementById("cf-address-body")).display,
      sales: getComputedStyle(document.getElementById("cf-sales-body")).display,
      salons: getComputedStyle(document.getElementById("cf-salons-body")).display,
      contacts: getComputedStyle(document.getElementById("cf-contacts-body")).display,
    };
  });
  assert(r7.address === "none", "сворачивание «Адрес» сработало");
  assert(r7.sales !== "none" && r7.salons !== "none" && r7.contacts !== "none", "остальные разделы не задеты: " + JSON.stringify(r7));

  const r8 = await page.evaluate(async () => {
    toggleFormSection("address"); // разворачиваем обратно для заполнения
    document.getElementById("c-company").value = "Кросс-Раздел Тест";
    document.getElementById("c-city").value = "Тюмень";
    document.getElementById("c-potential").value = "777000";
    addGeoGroup();
    const rows = document.querySelectorAll(".geo-group");
    rows[rows.length - 1].querySelector(".geo-city").value = "Тобольск";
    await saveClientToDb();
    await new Promise(r => setTimeout(r, 200));
    const c = S.clients[S.clients.length - 1];
    return { city: c.city, potential: c.potential, geoCity: c.geoLinks?.[0]?.city };
  });
  assert(r8.city === "Тюмень" && String(r8.potential).includes("777"), "поля из разделов «Адрес» и «Продажи» сохраняются вместе: " + JSON.stringify(r8));
  assert(r8.geoCity === "Тобольск", "поле из раздела «Салоны» тоже сохраняется: " + r8.geoCity);

  const r9 = await page.evaluate(() => {
    const c = S.clients[S.clients.length - 1];
    editClient(c.id);
    return { cityLoaded: document.getElementById("c-city").value, geoCityLoaded: document.querySelector(".geo-group .geo-city")?.value };
  });
  assert(r9.cityLoaded === "Тюмень" && r9.geoCityLoaded === "Тобольск", "данные из всех разделов корректно подгружаются при повторном редактировании: " + JSON.stringify(r9));

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

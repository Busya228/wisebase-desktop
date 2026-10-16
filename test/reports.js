// Вкладка «Аналитика → Отчёты» (загрузка .xlsx): разбор чисел из Excel, сводка
// за квартал/год, проценты выполнения плана больше 100%, склонения; общие отчёты
// в Supabase (таблица reports): кто может загружать, что уходит в базу, удаление,
// ошибки, загрузка с сервера и перенос старых «локальных» отчётов.
const { openApp, launch, assert } = require("./_helpers.js");

const row = (name, o) => Object.assign({ "РМ ФИО": name, "Направление_РМ": "Юг" }, o);

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  await page.evaluate(() => localStorage.removeItem("wb_rep_data"));

  // --- 1. Разбор значений ячеек ---
  const nums = await page.evaluate(() => {
    const c = window.__rep.cleanNum;
    return [c(1500), c("1 234 567"), c("1\u00a0234,5"), c("85%"), c("12,5 %"), c("(Пусто)"), c(""), c(null), c("abc"), c("2 000 ₽")];
  });
  assert(JSON.stringify(nums) === JSON.stringify([1500, 1234567, 1234.5, 0.85, 0.125, null, null, null, null, 2000]),
    "cleanNum: пробелы, запятая, проценты-строки, «(Пусто)», рубли: " + JSON.stringify(nums));

  // --- 2. Склонения ---
  const pl = await page.evaluate(() => [1, 2, 5, 11, 21, 22, 25].map(n => n + " " + window.__rep.plural(n, "менеджер", "менеджера", "менеджеров")));
  assert(pl.join("|") === "1 менеджер|2 менеджера|5 менеджеров|11 менеджеров|21 менеджер|22 менеджера|25 менеджеров", "plural: " + pl.join("|"));

  // --- 3. Сводка за квартал: суммы складываются, план/прирост пересчитываются, остатки — из последнего месяца ---
  const agg = await page.evaluate((rows) => {
    const r = window.__rep.repAggregate([{ rows: rows.m7 }, { rows: rows.m8 }]);
    return r.find(m => m.name === "Иванов");
  }, {
    m7: [row("Иванов", { "План_отгрузок_мес., руб.": 100, "Факт_отгрузки_мес., руб.": 120, "Факт отгрузки(прош. год)": 100, "НЕОТГРУЖЕННЫЕ текущего месяца": 50, "Факт С2, %": 0.2 })],
    m8: [row("Иванов", { "План_отгрузок_мес., руб.": 100, "Факт_отгрузки_мес., руб.": 60, "Факт отгрузки(прош. год)": 100, "НЕОТГРУЖЕННЫЕ текущего месяца": 10, "Факт С2, %": 0.4 })],
  });
  assert(agg && agg.factShip === 180 && agg.planShip === 200, "квартал: факт и план отгрузок суммируются: " + JSON.stringify(agg));
  assert(agg && Math.abs(agg.planPct - 0.9) < 1e-9, "квартал: выполнение плана = факт/план (90%), а не среднее процентов");
  assert(agg && Math.abs(agg.growth - (-0.1)) < 1e-9, "квартал: прирост пересчитан из сумм (−10%)");
  assert(agg && agg.unshipCur === 10, "квартал: неотгруженные — остаток последнего месяца, а не сумма");
  assert(agg && Math.abs(agg.c2fact - 0.3) < 1e-9, "квартал: С2 — среднее по месяцам");

  // --- 0. «Аналитика» по умолчанию открывается на «Отчётах», выбор запоминается ---
  const tabs = await page.evaluate(() => {
    const st = () => ({ rep: document.getElementById("an-tab-reports").classList.contains("active"),
      repPanel: document.getElementById("an-panel-reports").style.display, cliPanel: document.getElementById("an-panel-clients").style.display });
    showPage("analytics"); const first = st();
    switchAnTab("clients"); showPage("dashboard"); showPage("analytics"); const again = st();
    switchAnTab("reports");
    return { first, again };
  });
  assert(tabs.first.rep && tabs.first.repPanel === "" && tabs.first.cliPanel === "none", "по умолчанию открыта вкладка «Отчёты»: " + JSON.stringify(tabs.first));
  assert(!tabs.again.rep && tabs.again.cliPanel === "", "если выбрали «По клиентам», раздел открывается на ней: " + JSON.stringify(tabs.again));

  // --- 4. Отрисовка: месяц, перевыполнение плана, заголовок, кнопка удаления ---
  const month = await page.evaluate((rows) => {
    currentUser = { id: "a1" }; currentProfile = { id: "a1", role: "administrator", full_name: "Админ" };
    window.__rep.setData({ "2026-7": { rows: rows.m7, loaded: "01.08.2026, 10:00" }, "2026-8": { rows: rows.m8, loaded: "01.09.2026, 10:00" } });
    switchAnTab("reports");
    window.__rep.setPeriod("month", 2026, 6); // июль
    window.__rep.render();
    return {
      title: document.getElementById("repTableTitle").textContent,
      pcts: [...document.querySelectorAll("#repTableBody .rep-pct")].map(e => e.textContent),
      bars: [...document.querySelectorAll("#repTableBody .rep-bar-fill")].map(e => e.style.width),
      nav: document.getElementById("repNavMonth").textContent,
      del: document.getElementById("repDeleteBtn").style.display,
      noData: document.getElementById("repNoData").style.display,
    };
  }, {
    m7: [row("Иванов", { "Выполнение плана, отгр.": 1.25, "Факт_отгрузки_мес., руб.": 125 }), row("Петров", { "Выполнение плана, отгр.": 0.5, "Факт_отгрузки_мес., руб.": 50 })],
    m8: [row("Иванов", { "Выполнение плана, отгр.": 1, "Факт_отгрузки_мес., руб.": 100 })],
  });
  assert(month.title === "Юг — 2 менеджера", "заголовок таблицы с правильным склонением: " + month.title);
  assert(month.pcts[0] === "125%" && month.bars[0] === "100%", "перевыполнение плана показывается как 125%, полоска не шире 100%: " + JSON.stringify(month));
  assert(month.nav === "Июль", "название месяца «Июль» (было «Июл»): " + month.nav);
  assert(month.del === "" && month.noData === "none", "за месяц с данными администратор видит кнопку удаления, заглушки «Нет данных» нет");

  // --- 5. Квартал/Год реально переключают данные ---
  const q = await page.evaluate(() => {
    const tabs = document.querySelectorAll(".rep-period-tab");
    repSetPeriodType(tabs[1], "quarter");
    const quarter = { nav: document.getElementById("repNavMonth").textContent, upd: document.getElementById("repLastUpdate").textContent, del: document.getElementById("repDeleteBtn").style.display, title: document.getElementById("repTableTitle").textContent };
    repShiftMonth(1); // следующий квартал — данных нет
    const empty = { nav: document.getElementById("repNavMonth").textContent, noData: document.getElementById("repNoData").style.display, text: document.querySelector("#repNoData p").textContent };
    repShiftMonth(-1);
    repSetPeriodType(tabs[2], "year");
    const year = { nav: document.getElementById("repNavMonth").textContent, upd: document.getElementById("repLastUpdate").textContent };
    repSetPeriodType(tabs[0], "month");
    return { quarter, empty, year };
  });
  assert(q.quarter.nav === "III квартал" && q.quarter.upd === "Месяцев с данными: 2 из 3", "квартал собирает июль+август: " + JSON.stringify(q.quarter));
  assert(q.quarter.del === "none", "в режиме квартала кнопка удаления месяца скрыта");
  assert(/III квартал 2026/.test(q.quarter.title), "в заголовке таблицы указан период: " + q.quarter.title);
  assert(q.empty.nav === "IV квартал" && q.empty.noData === "" && /IV квартал 2026/.test(q.empty.text), "стрелка в режиме квартала листает по кварталам: " + JSON.stringify(q.empty));
  assert(q.year.nav === "Весь год" && q.year.upd === "Месяцев с данными: 2 из 12", "год: " + JSON.stringify(q.year));

  // --- 6. Права: полный доступ у всех ролей; без роли — только просмотр ---
  const noRole = await page.evaluate(() => {
    currentUser = { id: "x1" }; currentProfile = { id: "x1", role: null };
    window.__rep.setPeriod("month", 2026, 6); window.__rep.render();
    return { up: document.getElementById("repUploadBtn").style.display, del: document.getElementById("repDeleteBtn").style.display, rows: document.querySelectorAll("#repTableBody tr").length };
  });
  assert(noRole.up === "none" && noRole.del === "none" && noRole.rows === 2, "учётка без роли видит отчёт, но не меняет: " + JSON.stringify(noRole));
  const mgr = await page.evaluate(() => {
    currentUser = { id: "m1", email: "m1@x" }; currentProfile = { id: "m1", role: "manager", full_name: "Менеджер" };
    window.__rep.setPeriod("month", 2026, 6); window.__rep.render();
    return { up: document.getElementById("repUploadBtn").style.display, del: document.getElementById("repDeleteBtn").style.display,
             rows: document.querySelectorAll("#repTableBody tr").length };
  });
  assert(mgr.up === "" && mgr.del === "", "менеджер тоже может загружать и удалять отчёты: " + JSON.stringify(mgr));
  assert(mgr.rows === 2, "и видит общий отчёт: строк " + mgr.rows);
  for (const role of ["admin", "administrator", "user", "manager"]) {
    const v = await page.evaluate((role) => { currentProfile = { id: "a1", role, full_name: "Глава" }; window.__rep.render(); return document.getElementById("repUploadBtn").style.display; }, role);
    assert(v === "", "роль " + role + " может загружать отчёты");
  }

  // Перехватываем обращения к Supabase, чтобы проверить, что именно уходит в базу.
  await page.evaluate(() => {
    currentUser = { id: "a1", email: "a1@x" }; currentProfile = { id: "a1", role: "administrator", full_name: "Админ" };
    window.__calls = []; window.__failNext = null;
    sb.from = (table) => {
      const q = { table, ops: [] };
      const api = {
        select(c) { q.ops.push(["select", c]); return api; }, eq(k, v) { q.ops.push(["eq", k, v]); return api; },
        upsert(v, o) { q.ops.push(["upsert", v, o]); return api; }, delete() { q.ops.push(["delete"]); return api; },
        then(res) { window.__calls.push(q); const e = window.__failNext; window.__failNext = null; res({ data: window.__selectData || [], error: e }); },
      };
      return api;
    };
  });

  // --- 7. Файл без колонки ФИО не уходит в базу и даёт понятное сообщение ---
  const dialogs = [];
  page.on("dialog", d => { dialogs.push(d.message()); d.accept(); });
  await page.evaluate(() => {
    window.XLSX = { read: () => ({ SheetNames: ["Лист1"], Sheets: { "Лист1": {} } }), utils: { sheet_to_json: () => [{ "Что-то": 1 }] } };
  });
  await page.setInputFiles("#repFileInput", { name: "bad.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await page.waitForTimeout(300);
  assert(dialogs.some(m => /РМ ФИО/.test(m)), "файл без колонки «РМ ФИО» → понятное сообщение: " + JSON.stringify(dialogs));
  assert(await page.evaluate(() => !window.__calls.some(c => c.ops.some(o => o[0] === "upsert"))), "неправильный файл в базу не отправляется");

  // --- 8. Корректный файл сохраняется в Supabase (одна строка на месяц), «Итого» отброшено ---
  dialogs.length = 0;
  await page.evaluate(() => {
    window.__rep.setPeriod("month", 2026, 9); // октябрь — пустой
    window.XLSX = { read: () => ({ SheetNames: ["Лист1"], Sheets: { "Лист1": {} } }), utils: { sheet_to_json: () => [
      { "РМ ФИО": "Сидоров", "Факт_отгрузки_мес., руб.": "1 000", "Лишняя колонка": "много текста" },
      { "РМ ФИО": "Итого", "Факт_отгрузки_мес., руб.": 1000 },
      { "РМ ФИО": null },
    ] } };
  });
  await page.setInputFiles("#repFileInput", { name: "ok.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await page.waitForTimeout(300);
  const up = await page.evaluate(() => {
    const c = window.__calls.find(c => c.table === "reports" && c.ops.some(o => o[0] === "upsert"));
    const op = c && c.ops.find(o => o[0] === "upsert");
    return { rec: op && op[1], opt: op && op[2], local: window.__rep.getData()["2026-10"], cache: JSON.parse(localStorage.getItem(wbDataKey("wb_rep_cache")) || "{}")["2026-10"] };
  });
  assert(up.rec && up.rec.year === 2026 && up.rec.month === 10 && up.opt && up.opt.onConflict === "year,month", "отчёт уходит в таблицу reports за 2026-10 (upsert по месяцу): " + JSON.stringify(up.rec && { y: up.rec.year, m: up.rec.month, o: up.opt }));
  assert(up.rec && up.rec.rows.length === 1 && up.rec.rows[0]["РМ ФИО"] === "Сидоров" && !("Лишняя колонка" in up.rec.rows[0]), "в базу уходит 1 строка без лишних колонок");
  assert(up.rec && up.rec.uploaded_by === "a1" && up.rec.uploaded_by_name === "Админ" && up.rec.file_name === "ok.xlsx", "сохраняется, кто и какой файл загрузил");
  assert(up.local && up.cache, "после сохранения отчёт сразу виден и есть в офлайн-копии");

  // --- 9. Повторная загрузка спрашивает «Заменить у всех?»; удаление идёт в базу ---
  await page.setInputFiles("#repFileInput", { name: "ok.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await page.waitForTimeout(300);
  assert(dialogs.some(m => /уже загружен отчёт/.test(m) && /у всех/.test(m)), "повторная загрузка спрашивает подтверждение замены у всех");
  await page.evaluate(() => repDeleteMonth());
  await page.waitForTimeout(150);
  const del = await page.evaluate(() => ({
    call: window.__calls.find(c => c.table === "reports" && c.ops.some(o => o[0] === "delete")),
    has: "2026-10" in window.__rep.getData(), noData: document.getElementById("repNoData").style.display,
  }));
  assert(del.call && JSON.stringify(del.call.ops.filter(o => o[0] === "eq")) === JSON.stringify([["eq", "year", 2026], ["eq", "month", 10]]), "удаление — запрос к reports за 2026-10: " + JSON.stringify(del.call && del.call.ops));
  assert(!del.has && del.noData === "", "после удаления данных за месяц нет");

  // --- 10. Ошибка сохранения (нет таблицы) — понятное сообщение, данные не «появляются» ---
  dialogs.length = 0;
  await page.evaluate(() => { window.__failNext = { code: "42P01", message: 'relation "public.reports" does not exist' }; });
  await page.setInputFiles("#repFileInput", { name: "ok.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await page.waitForTimeout(300);
  assert(dialogs.some(m => /04_reports\.sql/.test(m)), "нет таблицы → подсказка запустить 04_reports.sql: " + JSON.stringify(dialogs));
  assert(await page.evaluate(() => !("2026-10" in window.__rep.getData())), "при ошибке сохранения отчёт не показывается как сохранённый");

  // --- 11. Загрузка с сервера + перенос старых «локальных» отчётов в общую базу ---
  const mig = await page.evaluate(async () => {
    window.__calls = [];
    window.__selectData = [{ year: 2026, month: 7, rows: [{ "РМ ФИО": "Серверный" }], file_name: "s.xlsx", loaded_at: "2026-08-01T07:00:00Z", uploaded_by_name: "Глава" }];
    localStorage.setItem("wb_legacy_data_owner",currentUser.id);
    localStorage.setItem("wb_rep_data", JSON.stringify({
      "2026-7": { rows: [{ "РМ ФИО": "Старый локальный" }], loaded: "x" },   // есть на сервере — не трогаем
      "2026-5": { rows: [{ "РМ ФИО": "Майский", "Мусор": 1 }], loaded: "x" }, // нет на сервере — переносим
    }));
    await repLoadRemote();
    window.__selectData = null;
    const ups = window.__calls.filter(c => c.ops.some(o => o[0] === "upsert")).map(c => c.ops.find(o => o[0] === "upsert")[1]);
    const d = window.__rep.getData();
    return { ups: ups.map(u => u.year + "-" + u.month + ":" + u.rows[0]["РМ ФИО"] + ":" + Object.keys(u.rows[0]).length),
             jul: d["2026-7"] && d["2026-7"].rows[0]["РМ ФИО"], may: !!d["2026-5"], legacy: localStorage.getItem("wb_rep_data"),
             by: d["2026-7"] && d["2026-7"].by };
  });
  assert(JSON.stringify(mig.ups) === JSON.stringify(["2026-5:Майский:1"]), "перенесён только месяц, которого нет на сервере: " + JSON.stringify(mig.ups));
  assert(mig.jul === "Серверный" && mig.by === "Глава", "серверная версия месяца главнее локальной, видно кто загрузил");
  assert(mig.may && mig.legacy === null, "после переноса локальная копия удалена");

  const mgrMig = await page.evaluate(async () => {
    currentProfile = { id: "x1", role: null };
    window.__calls = [];
    localStorage.setItem("wb_rep_data", JSON.stringify({ "2026-4": { rows: [{ "РМ ФИО": "Апрель" }] } }));
    await repLoadRemote();
    return { ups: window.__calls.filter(c => c.ops.some(o => o[0] === "upsert")).length, legacy: !!localStorage.getItem("wb_rep_data") };
  });
  assert(mgrMig.ups === 0 && mgrMig.legacy, "у учётки без роли локальные отчёты в базу не отправляются и не удаляются");
  const mMig = await page.evaluate(async () => {
    currentUser = { id: "m1", email: "m1@x" }; currentProfile = { id: "m1", role: "manager", full_name: "Менеджер" };
    localStorage.setItem("wb_legacy_data_owner",currentUser.id);
    window.__calls = [];
    await repLoadRemote();
    return { ups: window.__calls.filter(c => c.ops.some(o => o[0] === "upsert")).length, legacy: localStorage.getItem("wb_rep_data") };
  });
  assert(mMig.ups === 1 && mMig.legacy === null, "у менеджера старые локальные отчёты переносятся в общую базу: " + JSON.stringify(mMig));

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

// «Аналитика → Отчёты»: столбец «План оборот» (ручной ввод через «Редактировать»),
// % выполнения под «Отгрузки (факт)», приоритет ручного плана над планом из файла,
// сохранение в reports.rows, перенос при повторной загрузке, связь со «Статистикой».
const { openApp, launch, assert } = require("./_helpers.js");
const row = (name, o) => Object.assign({ "РМ ФИО": name, "Направление_РМ": "Юг" }, o);

(async () => {
  const { browser, page, errors } = await launch({ stub: true, init: "window.__TEST_STUB_AUDIT__=true;" });
  await openApp(page);
  const K = await page.evaluate(() => window.__rep.MANUAL_PLAN);

  const parsed = await page.evaluate((K) => {
    const p = window.__rep.parseRow;
    const a = p({ "РМ ФИО": "А", "План_отгрузок_мес., руб.": 100, "Факт_отгрузки_мес., руб.": 90, "Выполнение плана, отгр.": 0.9, [K]: 120 });
    const b = p({ "РМ ФИО": "Б", "План_отгрузок_мес., руб.": 100, "Факт_отгрузки_мес., руб.": 90 });
    const c = p({ "РМ ФИО": "В", "Факт_отгрузки_мес., руб.": 90 });
    return { a, b, c };
  }, K);
  assert(parsed.a.planShip === 120 && Math.abs(parsed.a.planPct - 0.75) < 1e-9 && parsed.a.planSrc === "manual", "ручной план главнее плана из файла, % = факт ÷ ручной план");
  assert(parsed.b.planShip === 100 && Math.abs(parsed.b.planPct - 0.9) < 1e-9 && parsed.b.planSrc === "file", "без ручного плана используется план из отчёта");
  assert(parsed.c.planShip === null && parsed.c.planPct === null && parsed.c.planSrc === null, "без плана — «не задан»");

  const agg = await page.evaluate((K) => window.__rep.repAggregate([
    { rows: [{ "РМ ФИО": "А", "Факт_отгрузки_мес., руб.": 50, [K]: 100 }] },
    { rows: [{ "РМ ФИО": "А", "Факт_отгрузки_мес., руб.": 100, "План_отгрузок_мес., руб.": 100 }] }])[0], K);
  assert(agg.planShip === 200 && Math.abs(agg.planPct - 0.75) < 1e-9 && agg.planSrc === "mixed", "квартал: ручной и файловый план складываются: " + JSON.stringify(agg));

  const ui = await page.evaluate((K) => {
    currentUser = { id: "a1" }; currentProfile = { id: "a1", role: "administrator", full_name: "Админ" };
    window.__rep.setData({ "2026-10": { rows: [
      { "РМ ФИО": "Иванов", "Направление_РМ": "Юг", "Факт_отгрузки_мес., руб.": 1100, "План_отгрузок_мес., руб.": 1000 },
      { "РМ ФИО": "Петров", "Направление_РМ": "Юг", "Факт_отгрузки_мес., руб.": 500 } ], loaded: "x" } });
    showPage("analytics"); switchAnTab("reports"); window.__rep.setPeriod("month", 2026, 9); window.__rep.render();
    const heads = [...document.querySelectorAll("#repTableSection thead th")].map(t => t.textContent.trim());
    const subs = [...document.querySelectorAll("#repTableBody tr td:nth-child(3) .rep-sub")].map(e => e.textContent);
    const plan = [...document.querySelectorAll("#repTableBody tr td:nth-child(2)")].map(e => e.textContent);
    return { heads, subs, plan, btn: document.getElementById("repEditBtn").style.display };
  }, K);
  assert(JSON.stringify(ui.heads) === JSON.stringify(["Менеджер", "План оборот", "Отгрузки (факт)", "Прирост к пр. году", "Заказы (факт)", "С2 факт / прогноз"]), "порядок столбцов: " + ui.heads.join(" | "));
  assert(ui.subs[0] === "110% плана" && ui.subs[1] === "план не задан", "под фактом отгрузок — % выполнения плана: " + JSON.stringify(ui.subs));
  assert(/1\s000\s₽из отчёта/.test(ui.plan[0]) && ui.plan[1] === "не задан", "столбец «План оборот»: " + JSON.stringify(ui.plan));
  assert(ui.btn === "", "кнопка «Редактировать» видна при отчёте за месяц");

  await page.click("#repEditBtn");
  await page.fill('#rep-plan-editor input[data-i="1"]', "abc");
  await page.click('#rep-plan-editor [data-act="save"]');
  const err = await page.textContent("#rep-pe-err");
  assert(/Проверьте/.test(err) && await page.$("#rep-plan-editor"), "некорректная сумма не сохраняется");
  await page.fill('#rep-plan-editor input[data-i="1"]', "1 000");
  await page.fill('#rep-plan-editor input[data-i="0"]', "2 200,5");
  await page.fill('#rep-pe-region', "3 200");
  await page.click('#rep-plan-editor [data-act="save"]');
  await page.waitForTimeout(300);
  const saved = await page.evaluate((K) => {
    const w = JSON.parse(localStorage.getItem("__wisebase_test_backend_writes") || "[]").filter(x => x.table === "reports");
    const rows = window.__rep.getData()["2026-10"].rows;
    return { op: w.at(-1)?.op, sent: w.at(-1)?.values?.rows?.map(r => r[K]), local: rows.map(r => r[K]),
      subs: [...document.querySelectorAll("#repTableBody tr td:nth-child(3) .rep-sub")].map(e => e.textContent),
      open: !!document.getElementById("rep-plan-editor") };
  }, K);
  assert(saved.op === "update" && JSON.stringify(saved.sent) === "[2200.5,1000]", "план отправлен в reports.rows через update: " + JSON.stringify(saved));
  assert(!saved.open && JSON.stringify(saved.local) === "[2200.5,1000]", "окно закрыто, локальные данные обновлены");
  assert(saved.subs[0] === "50% плана" && saved.subs[1] === "50% плана", "% выполнения пересчитан по ручному плану: " + JSON.stringify(saved.subs));

  const reg = await page.evaluate(() => ({ kpi: document.querySelector("#repKpis .rep-kpi .rk-lbl").textContent, val: document.querySelector("#repKpis .rep-kpi .rk-val").textContent, sub: document.querySelector("#repKpis .rep-kpi .rk-sub").textContent,
    n: document.querySelectorAll("#repKpis .rep-kpi").length, rows: window.__rep.getData()["2026-10"].rows.map(r => window.__rep.regionPlanOf([r])) }));
  assert(reg.n === 5 && reg.kpi === "План регион" && /50%/.test(reg.sub) && JSON.stringify(reg.rows) === "[3200,3200]", "первая карточка «План регион» с % выполнения: " + JSON.stringify(reg));

  const carry = await page.evaluate((K) => {
    const prev = [{ "РМ ФИО": "Иванов", "Направление_РМ": "Юг", [K]: 300 }, { "РМ ФИО": "Петров", "Направление_РМ": "Юг" }];
    const next = [{ "РМ ФИО": " иванов ", "Направление_РМ": "Юг", "Факт_отгрузки_мес., руб.": 1 }, { "РМ ФИО": "Сидоров", "Направление_РМ": "Юг" }];
    return window.__rep.carryPlans(prev, next);
  }, K);
  const carry2 = await page.evaluate(() => window.__rep.carryPlans([{ "РМ ФИО": "А", [window.__rep.REGION_PLAN]: 777 }], [{ "РМ ФИО": "Б" }]));
  assert(carry2.rows[0][await page.evaluate(() => window.__rep.REGION_PLAN)] === 777, "план регион сохраняется при повторной загрузке");
  assert(carry.n === 1 && carry.rows[0][K] === 300 && carry.rows[1][K] === undefined, "повторная загрузка сохраняет ручной план тех же менеджеров");

  const stats = await page.evaluate(() => { const t = srTotals(srAllMonths()[0].rows); return { plan: t.plan, pct: t.pct }; });
  assert(stats.plan === 3200.5 && Math.abs(stats.pct - 1600 / 3200.5) < 1e-9, "«Статистика» использует ручной план: " + JSON.stringify(stats));

  assert(errors.length === 0, "нет ошибок JS: " + errors.join("; "));
  await browser.close();
})();

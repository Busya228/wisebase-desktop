// «Статистика» → «По отчётам»: показатели, окно периода с пропущенными месяцами,
// фильтр менеджера, рейтинг, тепловая карта, пустое состояние, сохранение вкладки/периода.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  const r = await page.evaluate(() => {
    currentUser = { id: "a1" }; currentProfile = { id: "a1", role: "administrator", full_name: "Админ" };
    delete UIP.statsTab; delete UIP.srMonths;
    const out = {};
    // пустое состояние
    window.__rep.setData({});
    showPage("stats");
    out.emptyShown = document.getElementById("sr-empty").style.display !== "none";
    out.tabDefault = document.getElementById("st-tab-reports").classList.contains("active");
    const row = (n, plan, fact, prev) => ({ "РМ ФИО": n, "Направление_РМ": "Юг", "План_отгрузок_мес., руб.": plan,
      "Факт_отгрузки_мес., руб.": fact, "Факт отгрузки(прош. год)": prev, "Факт_заказов_мес., руб.": fact,
      "НЕОТГРУЖЕННЫЕ прошлых периодов": 0, "НЕОТГРУЖЕННЫЕ текущего месяца": 100000, "НЕОТГРУЖЕННЫЕ будущих периодов": 0,
      "Факт С2, %": 0.2, "С2, % Прогноз на 1 мес. вперед": 0.25 });
    window.__rep.setData({
      "2026-7": { rows: [row("Иванов", 1000000, 1200000, 1000000), row("Петрова", 1000000, 500000, 1000000)], loaded: "01.08.2026" },
      "2026-9": { rows: [row("Иванов", 1000000, 1100000, 1000000), row("Петрова", 1000000, 900000, 1000000)], loaded: "01.10.2026" },
    });
    renderStats();
    out.bodyShown = document.getElementById("sr-body").style.display !== "none";
    out.lbl = document.getElementById("sr-period-lbl").textContent;
    out.kpi = [...document.querySelectorAll("#sr-kpis .an-kpi")].map(k => k.querySelector(".k-lbl").textContent + "=" + k.querySelector(".k-val").textContent);
    out.cols = document.querySelectorAll("#sr-dyn .bar-col").length;
    out.noRep = [...document.querySelectorAll("#sr-dyn .bar-col")].filter(c => /нет отчёта/.test(c.textContent)).length;
    out.rank = [...document.querySelectorAll("#sr-rank tbody tr .st-name")].map(e => e.textContent);
    out.heatRows = [...document.querySelectorAll("#sr-heat tbody tr")].map(tr => [...tr.children].map(td => td.textContent).join("|"));
    setSrMgr("Петрова");
    out.kpiMgr = document.querySelector("#sr-kpis .an-kpi:nth-child(2) .k-val").textContent;
    out.mgrSel = document.getElementById("sr-mgr").value;
    setSrMgr("");
    setSrPeriod(0);
    out.colsAll = document.querySelectorAll("#sr-dyn .bar-col").length;
    out.savedMonths = UIP.srMonths;
    setSrDynMode("unship");
    out.unshipBars = document.querySelectorAll("#sr-dyn .bar-col .bar").length;
    switchStTab("offers");
    out.savedTab = UIP.statsTab;
    out.offersShown = document.getElementById("st-panel-offers").style.display !== "none" && document.getElementById("st-panel-reports").style.display === "none";
    switchStTab("reports");
    return out;
  });
  assert(r.emptyShown && r.tabDefault, "без отчётов — пустое состояние, вкладка «По отчётам» по умолчанию");
  assert(r.bodyShown && /месяцев с отчётом: 2 из 6/.test(r.lbl), "окно 6 мес. заканчивается последним отчётом: " + r.lbl);
  assert(r.cols === 6 && r.noRep === 4, "пропущенные месяцы показаны «нет отчёта»: " + r.cols + "/" + r.noRep);
  const k = r.kpi.join(" | ");
  assert(/Выполнение плана=93%/.test(k), "выполнение плана за период: " + k);
  assert(/Месяцев с планом ≥100%=1 из 2/.test(k), "месяцев с выполненным планом: " + k);
  assert(/Средний С2=20%/.test(k), "средний С2: " + k);
  assert(JSON.stringify(r.rank) === JSON.stringify(["Иванов", "Петрова"]), "рейтинг по факту: " + JSON.stringify(r.rank));
  assert(r.heatRows.length === 2 && /^Иванов\|·\|·\|·\|120\|·\|110$/.test(r.heatRows[0]), "тепловая карта: " + JSON.stringify(r.heatRows));
  assert(r.mgrSel === "Петрова" && r.kpiMgr === "70%", "фильтр менеджера пересчитывает показатели: " + r.kpiMgr);
  assert(r.colsAll === 3 && r.savedMonths === 0, "«Все месяцы» — от первого до последнего отчёта, период сохраняется: " + r.colsAll);
  assert(r.unshipBars === 6, "режим «Неотгружено» — 3 столбца на месяц: " + r.unshipBars);
  assert(r.savedTab === "offers" && r.offersShown, "вкладка «По предложениям» переключается и запоминается");
  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

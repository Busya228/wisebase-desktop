// «Статистика» в стиле «Аналитики»: показатели, период (3/6/12 мес / всё время,
// сохраняется в личных настройках), по ответственным, зависшие предложения, топ клиентов.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  const r = await page.evaluate(() => {
    currentUser = { id: "a1" }; currentProfile = { id: "a1", role: "administrator", full_name: "Админ" };
    allProfiles = [{ id: "a1", full_name: "Админ", role: "administrator" }, { id: "m1", full_name: "Анна", role: "manager" }];
    const ago = days => { const x = new Date(); x.setDate(x.getDate() - days); return x.toISOString().slice(0, 10); };
    const mkey = d => d.slice(0, 7);
    S.clients = [{ id: 1, company: "Альфа", status: "active", tags: [], history: [] }, { id: 2, company: "Бета", status: "active", tags: [], history: [] }];
    S.offers = [
      { id: 1, clientId: 1, amount: 100000, status: "agreed", date: ago(2), owner_id: "m1" },
      { id: 2, clientId: 2, amount: 300000, status: "agreed", date: ago(3), owner_id: "a1" },
      { id: 3, clientId: 1, amount: 50000, status: "declined", date: ago(4), owner_id: "m1" },
      { id: 4, clientId: 2, amount: 70000, status: "proposed", date: ago(45), owner_id: "a1" },
      { id: 5, clientId: 1, amount: 999000, status: "agreed", date: ago(500), owner_id: "m1" },   // вне 6 мес
    ];
    S.plans = {}; S.plans[mkey(ago(2))] = 200000;
    UIP.statsMonths = undefined; delete UIP.statsMonths;
    showPage("stats"); switchStTab("offers");
    const kpi = [...document.querySelectorAll("#st-kpis .an-kpi")].map(k => k.querySelector(".k-lbl").textContent + "=" + k.querySelector(".k-val").textContent);
    const owners = [...document.querySelectorAll("#st-owners tbody tr")].map(tr => tr.children[0].textContent);
    const stale = document.querySelectorAll("#st-stale .stuck-row").length;
    const top = [...document.querySelectorAll("#st-top .stuck-name")].map(e => e.textContent);
    setStatsPeriod(0);
    const kpiAll = document.querySelector("#st-kpis .an-kpi:nth-child(2) .k-val").textContent;
    const savedPeriod = UIP.statsMonths;
    const active = document.querySelector("#stats-period button.active").dataset.m;
    setDealsMode("count");
    const bars = document.querySelectorAll("#chart-deals .bar-col").length;
    setStatsPeriod(6);
    return { kpi, owners, stale, top, kpiAll, savedPeriod, active, bars, mode: UIP.statsDealsMode };
  });
  const k = r.kpi.join(" | ");
  assert(/Предложений=4/.test(k), "за 6 мес — 4 предложения (старое не считается): " + k);
  assert(/Согласовано=400\s000 ₽/.test(k), "согласовано за период: " + k);
  assert(/Конверсия=67%/.test(k), "конверсия = согласовано ÷ (согласовано + отклонено): " + k);
  assert(/План выполнен=/.test(k), "есть показатель выполнения плана: " + k);
  assert(JSON.stringify(r.owners) === JSON.stringify(["Админ (вы)", "Анна"]), "таблица по ответственным, по убыванию согласованного: " + JSON.stringify(r.owners));
  assert(r.stale === 1, "зависшие: «Предложено» дольше 30 дней");
  assert(JSON.stringify(r.top) === JSON.stringify(["Бета", "Альфа"]), "топ клиентов по согласованным: " + JSON.stringify(r.top));
  assert(/1\s399\s000 ₽/.test(r.kpiAll), "«Всё время» учитывает и старые предложения: " + r.kpiAll);
  assert(r.savedPeriod === 0 && r.active === "0", "выбранный период сохраняется в настройках");
  assert(r.bars === 12 && r.mode === "count", "динамика: «Всё время» — последние 12 месяцев, режим по количеству сохраняется");
  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

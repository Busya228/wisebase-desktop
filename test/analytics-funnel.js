// Проверяет расчёты аналитики: сумма потенциала, распределение по стадиям воронки,
// и определение «застрявших» клиентов (давно без движения и без следующего шага) —
// то, что показывается в разделе «Аналитика» и на дашборде.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  const r = await page.evaluate(() => {
    const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return dateToLocalStr(d); };

    S.clients.push({ id: 1, name: "A", status: "potential", potential: 100000, history: [], lastContact: daysAgo(45) }); // застрял: 45 дней без касания, без шага
    S.clients.push({ id: 2, name: "B", status: "potential", potential: 200000, history: [], lastContact: daysAgo(5) });  // недавно трогали — не застрял
    S.clients.push({ id: 3, name: "C", status: "active", potential: 300000, history: [], lastContact: daysAgo(90) });    // "active" тоже в PIPELINE — давно без движения, без шага = застрял
    S.clients.push({ id: 4, name: "D", status: "negotiation", potential: 400000, history: [], lastContact: daysAgo(60), nextContact: "2099-01-01" }); // давно, но есть следующий шаг
    S.clients.push({ id: 5, name: "E", status: "inactive", potential: 999999, history: [], lastContact: daysAgo(500) }); // «Не работаем» — вне воронки вообще

    const buckets = statusBuckets();
    const stuckIds = S.clients.filter(isStuck).map(c => c.id).sort();

    return {
      bucketCounts: { potential: buckets.potential.length, active: buckets.active.length, negotiation: buckets.negotiation.length, inactive: buckets.inactive.length },
      potentialSum: sumPotential(buckets.potential),
      stuckIds,
      hasNextStepD: hasNextStep(S.clients.find(c => c.id === 4)),
      hasNextStepA: hasNextStep(S.clients.find(c => c.id === 1)),
    };
  });

  assert(r.bucketCounts.potential === 2, "statusBuckets — 2 клиента на стадии «Потенциальный» (A и B): " + r.bucketCounts.potential);
  assert(r.bucketCounts.active === 1, "statusBuckets — 1 клиент «Действующий» (C): " + r.bucketCounts.active);
  assert(r.bucketCounts.negotiation === 1, "statusBuckets — 1 клиент «Переговоры» (D): " + r.bucketCounts.negotiation);
  assert(r.bucketCounts.inactive === 1, "statusBuckets — 1 клиент «Не работаем» (E), вне воронки: " + r.bucketCounts.inactive);
  assert(r.potentialSum === 300000, "sumPotential — сумма A+B (100000+200000): " + r.potentialSum);

  assert(r.hasNextStepD === true, "hasNextStep — клиент D с nextContact в будущем имеет следующий шаг");
  assert(r.hasNextStepA === false, "hasNextStep — клиент A без задач и без даты контакта — следующего шага нет");

  // PIPELINE = ['potential','negotiation','active'] — «Действующий» тоже считается
  // «в воронке» (в отличие от «Не работаем»), поэтому давний без-шага C тоже застрял.
  assert(JSON.stringify(r.stuckIds) === JSON.stringify([1, 3]), "isStuck — застряли A и C (давно, без шага, статус в PIPELINE): " + JSON.stringify(r.stuckIds));
  assert(!r.stuckIds.includes(2), "isStuck — B не застрял, его трогали недавно");
  assert(r.stuckIds.includes(3), "isStuck — C (active) тоже в пайплайне и считается застрявшим при отсутствии движения");
  assert(!r.stuckIds.includes(4), "isStuck — D не застрял, у него есть следующий шаг (nextContact)");
  assert(!r.stuckIds.includes(5), "isStuck — E (не работаем) вне PIPELINE, не считается застрявшим вообще");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

// Проверяет логику напоминаний: просроченные задачи (checkOverdueAndNotify) и
// «скоро наступит время» (checkUpcomingReminders, окно 0–15 минут), плюс защиту
// от повторного показа одного и того же уведомления (notifSeenKeys).
// Время берём ОТНОСИТЕЛЬНО реального «сейчас» на момент запуска теста — не
// подделываем часы, чтобы не зависеть от конкретной версии Playwright.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  const r = await page.evaluate(() => {
    const hm = mins => { const d = new Date(Date.now() + mins * 60000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
    currentUser = { id: "u1" }; currentProfile = { id: "u1", role: "admin" };

    // --- checkUpcomingReminders: три задачи на сегодня в разных временных зонах ---
    S.tasks.push({ id: 101, text: "Через 10 минут", date: today(), time: hm(10), done: false, owner_id: "u1", clientId: 0 }); // должна попасть (0<diff<=15)
    S.tasks.push({ id: 102, text: "Через 20 минут", date: today(), time: hm(20), done: false, owner_id: "u1", clientId: 0 }); // мимо окна — рано
    S.tasks.push({ id: 103, text: "5 минут назад", date: today(), time: hm(-5), done: false, owner_id: "u1", clientId: 0 }); // уже наступило — не «скоро»

    notifList = []; notifSeenKeys = new Set();
    checkUpcomingReminders();
    const afterFirst = notifList.length;
    const keys = notifList.map(n => n.key);

    // Повторный вызов сразу же — не должен задвоить те же уведомления (notifSeenKeys).
    checkUpcomingReminders();
    const afterSecond = notifList.length;

    return { afterFirst, afterSecond, keys };
  });

  assert(r.afterFirst === 1, "checkUpcomingReminders — сработала ровно одна задача из трёх (через 10 минут): " + r.afterFirst);
  assert(r.keys.some(k => k.includes("101")), "сработавшее уведомление — именно задача 101 (через 10 минут): " + JSON.stringify(r.keys));
  assert(r.afterSecond === r.afterFirst, "повторный вызов не плодит дубликат того же уведомления (notifSeenKeys)");

  // --- checkOverdueAndNotify: просроченные задачи считаются и озвучиваются одним уведомлением ---
  const r2 = await page.evaluate(() => {
    S.tasks.push({ id: 201, text: "Просрочена 1", date: "2000-01-01", time: "", done: false, owner_id: "u1", clientId: 0 });
    S.tasks.push({ id: 202, text: "Просрочена 2", date: "2000-01-02", time: "", done: false, owner_id: "u1", clientId: 0 });
    S.tasks.push({ id: 203, text: "Просрочена, но выполнена", date: "2000-01-01", time: "", done: true, owner_id: "u1", clientId: 0 }); // done — не считается
    S.tasks.push({ id: 204, text: "Будущая задача", date: "2099-01-01", time: "", done: false, owner_id: "u1", clientId: 0 }); // не просрочена

    notifList = []; notifSeenKeys = new Set();
    checkOverdueAndNotify();
    const n = notifList[0];
    return { count: notifList.length, body: n ? n.body : null };
  });
  assert(r2.count === 1, "checkOverdueAndNotify — одно сводное уведомление, не по одному на задачу: " + r2.count);
  assert(r2.body && r2.body.includes("2"), "в сводке верно указано число просроченных (2, а не 3 — выполненная не считается): " + r2.body);

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

// Проверяет самое рискованное место в приложении: офлайн-очередь изменений.
// Без сети запись должна уходить в очередь, переживать перезагрузку страницы,
// а при появлении сети — проиграться и очистить очередь.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  const context = page.context();

  await openApp(page);
  await page.evaluate(() => {
    currentUser = { id: "u1", email: "test@test.ru" };
    currentProfile = { id: "u1", role: "admin", full_name: "Тест" };
  });

  // --- 1. Офлайн: запись уходит в очередь, не пытается достучаться до сети ---
  await context.setOffline(true);
  const afterWrite = await page.evaluate(async () => {
    const before = offlineQueue.length;
    const r = await dbWrite({ table: "tasks", op: "update", values: { done: true }, match: { eq: [["id", 1]] } });
    return { before, after: offlineQueue.length, queued: r.queued, persisted: JSON.parse(localStorage.getItem("crm_offline_queue_v1") || "[]").length };
  });
  assert(afterWrite.after === afterWrite.before + 1, "офлайн: запись добавляется в очередь (" + afterWrite.before + " -> " + afterWrite.after + ")");
  assert(afterWrite.queued === true, "офлайн: dbWrite() возвращает queued:true, не ошибку");
  assert(afterWrite.persisted === afterWrite.after, "офлайн: очередь сохранена в localStorage, не только в памяти");

  // --- 2. Очередь переживает перезагрузку страницы (офлайн всё ещё) ---
  // openApp() в этих тестах намеренно минует настоящий вход (см. _helpers.js) —
  // поэтому после перезагрузки повторяем то, что в реальном приложении делает
  // initApp()/localInit() после восстановления сессии: подтягиваем currentUser
  // и явно поднимаем очередь из localStorage.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    currentUser = { id: "u1", email: "test@test.ru" };
    currentProfile = { id: "u1", role: "admin", full_name: "Тест" };
    loadOfflineQueue();
  });
  const afterReload = await page.evaluate(() => offlineQueue.length);
  assert(afterReload === afterWrite.after, "очередь пережила перезагрузку страницы: осталось " + afterReload + " (ожидалось " + afterWrite.after + ")");

  // --- 3. Несколько операций подряд копятся по порядку, не теряются ---
  const afterMore = await page.evaluate(async () => {
    await dbWrite({ table: "tasks", op: "update", values: { done: false }, match: { eq: [["id", 2]] } });
    await dbWrite({ table: "clients", op: "update", values: { name: "X" }, match: { eq: [["id", 3]] } });
    return offlineQueue.length;
  });
  assert(afterMore === afterReload + 2, "несколько офлайн-операций подряд копятся все (стало " + afterMore + ")");

  // --- 4. Сеть вернулась — очередь проигрывается и очищается ---
  await context.setOffline(false);
  const afterFlush = await page.evaluate(async () => {
    await flushQueue();
    return { len: offlineQueue.length, persisted: JSON.parse(localStorage.getItem("crm_offline_queue_v1") || "[]").length };
  });
  assert(afterFlush.len === 0, "после flushQueue() онлайн очередь опустела (осталось " + afterFlush.len + ")");
  assert(afterFlush.persisted === 0, "localStorage тоже очищен, не только память");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

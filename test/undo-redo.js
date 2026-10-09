// Проверяет отмену/повтор действий (undo/redo) — снимки состояния хранятся в
// IndexedDB, стек отмены/повтора в памяти. Проверяем и сам откат данных, и то,
// что новое состояние действительно попадает в IndexedDB, а не теряется.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  await page.evaluate(() => {
    currentUser = { id: "u1", email: "test@test.ru" };
    currentProfile = { id: "u1", role: "admin", full_name: "Тест" };
    S.clients.push({ id: 1, name: "Исходное имя", company: "ООО", status: "active", owner_id: "u1", avatar: "И", color: "c1", tags: [], history: [] });
    // Реконсиляция с сервером изолируется — тестируем сам механизм undo/redo,
    // а не сетевой слой (его покрывает offline-queue.js).
    window.reconcileToSupabase = async () => {};
    _lastSnapshot = JSON.stringify(S);
  });

  const r = await page.evaluate(async () => {
    S.clients[0].name = "Новое имя";
    save();
    await new Promise(res => setTimeout(res, 250)); // дать IndexedDB-записи завершиться

    const afterEdit = S.clients[0].name;
    await undo();
    const afterUndo = { name: S.clients[0]?.name, count: S.clients.length };
    const idbAfterUndo = JSON.parse(await idbGet(SK)).clients[0]?.name;

    await redo();
    const afterRedo = { name: S.clients[0]?.name, count: S.clients.length };
    const idbAfterRedo = JSON.parse(await idbGet(SK)).clients[0]?.name;

    // Повторный undo без изменений после него — стек не должен уйти в минус/сломаться.
    await undo();
    const secondUndoOk = S.clients[0]?.name === "Исходное имя";

    return { afterEdit, afterUndo, idbAfterUndo, afterRedo, idbAfterRedo, secondUndoOk };
  });

  assert(r.afterEdit === "Новое имя", "правка применилась перед проверкой undo");
  assert(r.afterUndo.name === "Исходное имя", "undo() восстанавливает предыдущее имя в S");
  assert(r.afterUndo.count === 1, "undo() не теряет и не дублирует записи (клиентов: " + r.afterUndo.count + ")");
  assert(r.idbAfterUndo === "Исходное имя", "undo() записывает откат в IndexedDB, не только в память");
  assert(r.afterRedo.name === "Новое имя", "redo() возвращает изменение обратно в S");
  assert(r.idbAfterRedo === "Новое имя", "redo() тоже фиксируется в IndexedDB");
  assert(r.secondUndoOk, "повторный undo снова откатывает корректно (стек не ломается)");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

// Проверяет защиту от двойного сохранения (двойной клик/тап по «Сохранить» до
// того, как модалка успела закрыться). Без защиты два быстрых вызова подряд
// создавали ДВЕ одинаковые записи — проверено вручную перед тем, как чинить.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);
  await page.evaluate(() => {
    currentUser = { id: "u1", email: "test@test.ru" };
    currentProfile = { id: "u1", role: "admin", full_name: "Тест" };
  });

  // --- Клиент ---
  const rClient = await page.evaluate(async () => {
    openAddClient();
    document.getElementById("c-company").value = "Клиент-дубль";
    const before = S.clients.length;
    await Promise.all([saveClientToDb(), saveClientToDb()]);
    await new Promise(r => setTimeout(r, 300));
    return { before, after: S.clients.length };
  });
  assert(rClient.after === rClient.before + 1, "двойной клик по сохранению клиента создаёт ровно одну запись, не две (стало " + rClient.after + ")");

  // --- Задача ---
  const rTask = await page.evaluate(async () => {
    openAddTask();
    document.getElementById("t-text").value = "Задача-дубль";
    const before = S.tasks.length;
    await Promise.all([saveTaskToDb(), saveTaskToDb()]);
    await new Promise(r => setTimeout(r, 300));
    return { before, after: S.tasks.length };
  });
  assert(rTask.after === rTask.before + 1, "двойной клик по сохранению задачи создаёт ровно одну запись, не две (стало " + rTask.after + ")");

  // --- Предложение ---
  const rOffer = await page.evaluate(async () => {
    openAddOffer(S.clients[0].id);
    document.getElementById("o-text").value = "Предложение-дубль";
    document.querySelector("#o-channel-btns .ch-btn")?.click();
    const before = S.offers.length;
    await Promise.all([saveOfferToDb(), saveOfferToDb()]);
    await new Promise(r => setTimeout(r, 300));
    return { before, after: S.offers.length };
  });
  assert(rOffer.after === rOffer.before + 1, "двойной клик по сохранению предложения создаёт ровно одну запись, не две (стало " + rOffer.after + ")");

  // --- Обычное одиночное сохранение по-прежнему работает (флаг корректно освобождается) ---
  const rNormal = await page.evaluate(async () => {
    openAddClient();
    document.getElementById("c-company").value = "Обычный клиент";
    const before = S.clients.length;
    await saveClientToDb();
    const afterFirst = S.clients.length;
    // Второе, ОТДЕЛЬНОЕ (не одновременное) сохранение должно пройти нормально —
    // флаг не должен «залипнуть» после первого успешного сохранения.
    openAddClient();
    document.getElementById("c-company").value = "Ещё один обычный клиент";
    await saveClientToDb();
    const afterSecond = S.clients.length;
    return { before, afterFirst, afterSecond };
  });
  assert(rNormal.afterFirst === rNormal.before + 1, "обычное одиночное сохранение клиента работает как раньше");
  assert(rNormal.afterSecond === rNormal.afterFirst + 1, "флаг защиты корректно освобождается — следующее сохранение не блокируется навсегда");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

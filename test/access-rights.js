// Проверяет разграничение видимости данных: администратор видит всё (с учётом
// личного фильтра adminViewOwners), руководитель/пользователь — только своё и то,
// что явно делегировано. Это тот самый слой, который однажды показал 53 клиента
// вместо 6 из-за не полностью подключённого scopedClients().
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  // --- 1. Обычный пользователь (manager/user): видит только своё + общее ---
  const asUser = await page.evaluate(() => {
    S.clients.push({ id: 1, name: "Мой клиент", owner_id: "u1", status: "active", tags: [], history: [] });
    S.clients.push({ id: 2, name: "Чужой клиент", owner_id: "u2", status: "active", tags: [], history: [] });
    S.clients.push({ id: 3, name: "Ничей клиент", owner_id: null, status: "active", tags: [], history: [] });
    S.tasks.push({ id: 1, text: "Моя задача", owner_id: "u1", isShared: false, date: today(), done: false });
    S.tasks.push({ id: 2, text: "Чужая задача", owner_id: "u2", isShared: false, date: today(), done: false });
    S.tasks.push({ id: 3, text: "Общая задача", owner_id: "u2", isShared: true, date: today(), done: false });
    currentUser = { id: "u1" };
    currentProfile = { id: "u1", role: "manager" };
    delegatedFrom = new Set(); // никто не делегировал доступ
    return {
      clients: scopedClients().map(c => c.id).sort(),
      tasks: scopedTasks().map(t => t.id).sort(),
    };
  });
  assert(JSON.stringify(asUser.clients) === JSON.stringify([1]), "manager без делегирования видит только своего клиента: " + JSON.stringify(asUser.clients));
  assert(JSON.stringify(asUser.tasks) === JSON.stringify([1, 3]), "manager видит свою задачу + общую, не чужую: " + JSON.stringify(asUser.tasks));

  // --- 2. Делегирование открывает доступ к конкретному коллеге ---
  const asDelegate = await page.evaluate(() => {
    delegatedFrom = new Set(["u2"]);
    return { clients: scopedClients().map(c => c.id).sort(), tasks: scopedTasks().map(t => t.id).sort() };
  });
  assert(JSON.stringify(asDelegate.clients) === JSON.stringify([1, 2]), "после делегирования от u2 видны свои + его клиенты: " + JSON.stringify(asDelegate.clients));
  assert(JSON.stringify(asDelegate.tasks) === JSON.stringify([1, 2, 3]), "делегирование открывает и его задачи тоже: " + JSON.stringify(asDelegate.tasks));

  // --- 3. Администратор по умолчанию видит всё, без делегирований ---
  const asAdmin = await page.evaluate(() => {
    delegatedFrom = new Set();
    currentUser = { id: "u1" };
    currentProfile = { id: "u1", role: "admin" };
    adminViewOwners = null;
    return scopedClients().map(c => c.id).sort();
  });
  assert(JSON.stringify(asAdmin) === JSON.stringify([1, 2, 3]), "admin без личного фильтра видит всех клиентов: " + JSON.stringify(asAdmin));

  // --- 4. Личный фильтр администратора сужает список — именно тот баг, что был найден вручную ---
  const asAdminFiltered = await page.evaluate(() => {
    adminViewOwners = new Set(["u1"]); // админ оставил видимым только себя
    return scopedClients().map(c => c.id).sort();
  });
  assert(JSON.stringify(asAdminFiltered) === JSON.stringify([1]), "личный фильтр администратора реально сужает видимость: " + JSON.stringify(asAdminFiltered));

  // --- 5. adminOwnerVisible корректно обрабатывает "без ответственного" (__none__) ---
  const noneCase = await page.evaluate(() => {
    adminViewOwners = new Set(["__none__"]);
    return scopedClients().map(c => c.id).sort();
  });
  assert(JSON.stringify(noneCase) === JSON.stringify([3]), "фильтр «без ответственного» показывает только клиента с owner_id=null: " + JSON.stringify(noneCase));

  // --- 6. canEditClient/canEditTask согласованы со scopedClients/scopedTasks ---
  const editRights = await page.evaluate(() => {
    adminViewOwners = null;
    currentUser = { id: "u1" };
    currentProfile = { id: "u1", role: "manager" };
    delegatedFrom = new Set();
    const own = S.clients.find(c => c.id === 1);
    const other = S.clients.find(c => c.id === 2);
    return { own: canEditClient(own), other: canEditClient(other) };
  });
  assert(editRights.own === true, "canEditClient() разрешает править свой клиент");
  assert(editRights.other === false, "canEditClient() запрещает править чужой клиент без делегирования");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

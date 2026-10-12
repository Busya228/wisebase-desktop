// Роль «Руководитель подразделения» (profiles.role = 'user'): видит и редактирует
// всех клиентов, назначает ответственного; задачи — как у manager (свои +
// делегированные + общие); доступ к данным коллег ему назначает администратор. Тест закрепляет это поведение, чтобы случайная правка
// не открыла лишнего или не урезала права.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  const r = await page.evaluate(() => {
    S.clients.push({ id: 1, name: "Мой", owner_id: "h1", status: "active", tags: [], history: [] });
    S.clients.push({ id: 2, name: "Менеджера", owner_id: "m2", status: "active", tags: [], history: [] });
    S.clients.push({ id: 3, name: "Ничей", owner_id: null, status: "active", tags: [], history: [] });
    S.tasks.push({ id: 1, text: "Моя", owner_id: "h1", isShared: false, date: today(), done: false });
    S.tasks.push({ id: 2, text: "Менеджера", owner_id: "m2", isShared: false, date: today(), done: false });
    S.tasks.push({ id: 3, text: "Общая", owner_id: "m2", isShared: true, date: today(), done: false });
    currentUser = { id: "h1" };
    currentProfile = { id: "h1", role: "user" };
    delegatedFrom = new Set();
    adminViewOwners = new Set(["h1"]); // личный фильтр администратора не должен влиять на руководителя
    const out = {
      head: isHeadRole(), admin: isAdmin(), manager: isManagerRole(),
      clients: scopedClients().map(c => c.id).sort(),
      tasks: scopedTasks().map(t => t.id).sort(),
      editOther: canEditClient(S.clients[1]), editNone: canEditClient(S.clients[2]),
      editOtherTask: canEditTask(S.tasks[1]), editShared: canEditTask(S.tasks[2]),
      label: ROLE_LABELS[currentProfile.role],
    };
    delegatedFrom = new Set(["m2"]);
    out.tasksDelegated = scopedTasks().map(t => t.id).sort();
    adminViewOwners = null;
    return out;
  });
  assert(r.head && !r.admin && !r.manager, "role='user' распознаётся как руководитель подразделения");
  assert(JSON.stringify(r.clients) === "[1,2,3]", "руководитель подразделения видит всех клиентов: " + JSON.stringify(r.clients));
  assert(r.editOther && r.editNone, "и может редактировать любого клиента");
  assert(JSON.stringify(r.tasks) === "[1,3]", "задачи — только свои и общие, как у manager: " + JSON.stringify(r.tasks));
  assert(!r.editOtherTask && r.editShared, "чужую задачу без делегирования править нельзя, общую — можно");
  assert(JSON.stringify(r.tasksDelegated) === "[1,2,3]", "делегирование открывает задачи менеджера: " + JSON.stringify(r.tasksDelegated));
  assert(r.label === "Руководитель подразделения", "подпись роли в меню профиля: " + r.label);

  // Блок «Ответственный» в карточке клиента и раздел делегирования доступны руководителю.
  const ui = await page.evaluate(() => {
    allProfiles = [{ id: "h1", full_name: "Глава", role: "user" }, { id: "m2", full_name: "Менеджер", role: "manager" }];
    renderOwnerSelect("m2");
    renderMgrDelegationList();
    return {
      owner: document.getElementById("c-owner-wrap")?.style.display,
      ownerOpts: [...document.querySelectorAll("#c-owner option")].map(o => o.value),
      mgr: document.getElementById("set-mgr-wrap")?.style.display,
    };
  });
  assert(ui.owner === "" && ui.ownerOpts.includes("m2"), "руководитель подразделения может выбрать ответственного: " + JSON.stringify(ui));
  assert(ui.mgr === "none", "раздел «Доступ к данным коллег» руководителю подразделения НЕ доступен (только администратору)");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

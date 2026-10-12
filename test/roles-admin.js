// «Роли сотрудников» (Профиль → Настройки) — только для администратора.
// Свою роль поменять нельзя; в базу уходят только изменённые роли через
// функцию wb_set_user_role (supabase/05_roles.sql); понятная ошибка, если SQL не выполнен.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  await page.evaluate(() => {
    window.__profiles = [
      { id: "a1", full_name: "Админ", role: "administrator" },
      { id: "h1", full_name: "Глава", role: "user" },
      { id: "m1", full_name: "Анна", role: "manager" },
      { id: "m2", full_name: "Борис", role: "manager" },
    ];
    allProfiles = JSON.parse(JSON.stringify(window.__profiles));
    window.__rpc = []; window.__rpcError = null;
    sb.rpc = async (fn, args) => { window.__rpc.push([fn, args]); return { data: null, error: window.__rpcError }; };
    sb.from = () => { const api = { select() { return api; }, eq() { return api; }, then(res) { res({ data: JSON.parse(JSON.stringify(window.__profiles)), error: null }); } }; return api; };
    window.__toasts = []; const t = window.toast; window.toast = (m) => { window.__toasts.push(m); };
  });

  for (const role of ["manager", "user"]) {
    const v = await page.evaluate(async (role) => {
      currentUser = { id: "m1" }; currentProfile = { id: "m1", role };
      renderRolesList();
      _rolesDraft = new Map([["m1", "administrator"]]);
      await saveRoles();
      return { shown: document.getElementById("set-roles-wrap").style.display, calls: window.__rpc.length };
    }, role);
    assert(v.shown === "none", "роль " + role + ": раздела «Роли сотрудников» нет");
    assert(v.calls === 0, "роль " + role + ": сменить роль даже вызовом функции нельзя");
  }

  const r = await page.evaluate(async () => {
    currentUser = { id: "a1" }; currentProfile = { id: "a1", role: "administrator" };
    renderRolesList();
    const sels = [...document.querySelectorAll(".set-role-sel")];
    const info = {
      shown: document.getElementById("set-roles-wrap").style.display,
      order: sels.map(s => s.dataset.id),
      values: sels.map(s => s.value),
      ownDisabled: sels.find(s => s.dataset.id === "a1").disabled,
      othersEnabled: sels.filter(s => s.dataset.id !== "a1").every(s => !s.disabled),
      labels: [...sels.find(s => s.dataset.id === "m1").options].map(o => o.textContent),
    };
    const sel = id => sels.find(s => s.dataset.id === id);
    sel("m1").value = "user"; onRoleChange(sel("m1"));
    sel("m2").value = "user"; onRoleChange(sel("m2"));
    sel("m2").value = "manager"; onRoleChange(sel("m2"));   // вернул как было — не отправляем
    window.__rpc = [];
    info.ok = await saveRoles();
    info.calls = window.__rpc;
    info.m1role = allProfiles.find(p => p.id === "m1").role;
    return info;
  });
  assert(r.shown === "", "администратор видит раздел «Роли сотрудников»");
  assert(JSON.stringify(r.order) === JSON.stringify(["a1", "m1", "m2", "h1"]), "сотрудники по алфавиту: " + JSON.stringify(r.order));
  assert(JSON.stringify(r.values) === JSON.stringify(["administrator", "manager", "manager", "user"]), "у каждого выбрана текущая роль: " + JSON.stringify(r.values));
  assert(r.ownDisabled && r.othersEnabled, "свою роль изменить нельзя, чужие — можно");
  assert(JSON.stringify(r.labels) === JSON.stringify(["Администратор", "Руководитель подразделения", "Руководитель"]), "названия ролей: " + JSON.stringify(r.labels));
  assert(r.ok && JSON.stringify(r.calls) === JSON.stringify([["wb_set_user_role", { p_user: "m1", p_role: "user" }]]), "в базу ушла только реально изменённая роль: " + JSON.stringify(r.calls));

  const own = await page.evaluate(async () => { window.__rpc = []; _rolesDraft = new Map([["a1", "manager"]]); await saveRoles(); return window.__rpc.length; });
  assert(own === 0, "свою роль не отправляем даже в обход интерфейса");

  const e = await page.evaluate(async () => {
    window.__toasts = []; window.__rpcError = { message: "Could not find the function public.wb_set_user_role(p_role, p_user)", code: "PGRST202" };
    _rolesDraft = new Map([["m2", "user"]]); const ok1 = await saveRoles(); const t1 = window.__toasts.slice();
    window.__toasts = []; window.__rpcError = { message: "Нельзя снять роль с последнего администратора — сначала назначьте другого" };
    _rolesDraft = new Map([["m2", "user"]]); const ok2 = await saveRoles();
    window.__rpcError = null;
    return { ok1, t1, ok2, t2: window.__toasts.slice() };
  });
  assert(!e.ok1 && /05_roles\.sql/.test(e.t1[0] || ""), "если SQL не выполнен — подсказка про 05_roles.sql: " + JSON.stringify(e.t1));
  assert(!e.ok2 && /последнего администратора/.test(e.t2[0] || ""), "ошибка базы показывается понятным текстом: " + JSON.stringify(e.t2));

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

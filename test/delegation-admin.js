// Доступ к данным коллег (access_delegations) назначает ТОЛЬКО администратор:
// раздел в Настройках виден только ему; он выбирает сотрудника, отмечает, чьи
// данные тому открыть, и сохраняет — в базу уходит только разница.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  await page.evaluate(() => {
    allProfiles = [
      { id: "a1", full_name: "Админ", role: "administrator" },
      { id: "h1", full_name: "Глава", role: "user" },
      { id: "m1", full_name: "Анна", role: "manager" },
      { id: "m2", full_name: "Борис", role: "manager" },
    ];
    window.__calls = [];
    window.__delegs = [{ owner_id: "m2", delegate_id: "m1" }]; // Анне уже открыт Борис
    sb.from = (table) => {
      const q = { table, ops: [] };
      const api = {
        select(c) { q.ops.push(["select", c]); return api; }, eq(k, v) { q.ops.push(["eq", k, v]); return api; },
        insert(v) { q.ops.push(["insert", v]); return api; }, delete() { q.ops.push(["delete"]); return api; },
        then(res) { window.__calls.push(q); const sel = q.ops.some(o => o[0] === "select") && !q.ops.some(o => o[0] === "eq");
          res({ data: sel ? window.__delegs : [], error: null }); },
      };
      return api;
    };
  });

  // --- Не администратор: раздела нет ---
  for (const role of ["manager", "user"]) {
    const v = await page.evaluate(async (role) => {
      currentUser = { id: "m1" }; currentProfile = { id: "m1", role };
      await renderMgrDelegationList();
      return document.getElementById("set-mgr-wrap").style.display;
    }, role);
    assert(v === "none", "роль " + role + ": раздела «Доступ к данным коллег» нет");
  }
  const silent = await page.evaluate(async () => { window.__calls = []; _delegDraft = new Map([["m1", new Set(["a1"])]]); await saveMgrDelegation(); _delegDraft = new Map(); return window.__calls.length; });
  assert(silent === 0, "не администратор не может ничего сохранить даже вызовом функции");

  // --- Администратор ---
  const r = await page.evaluate(async () => {
    currentUser = { id: "a1" }; currentProfile = { id: "a1", role: "administrator" };
    await renderMgrDelegationList();
    const sel = document.getElementById("set-mgr-delegate");
    return {
      shown: document.getElementById("set-mgr-wrap").style.display,
      delegates: [...sel.options].map(o => o.value),
      selected: sel.value,
      checked: [...document.querySelectorAll(".set-mgr-cb:checked")].map(c => c.value),
      labelM1: [...sel.options].find(o => o.value === "m1").textContent,
    };
  });
  assert(r.shown === "", "администратор видит раздел");
  assert(JSON.stringify(r.delegates) === JSON.stringify(["m1", "m2", "h1"]), "в списке сотрудники без администраторов (по алфавиту): " + JSON.stringify(r.delegates));
  assert(r.selected === "m1" && JSON.stringify(r.checked) === JSON.stringify(["m2"]), "у Анны отмечен уже открытый доступ к Борису: " + JSON.stringify(r));
  assert(/открыт доступ: 1/.test(r.labelM1), "в списке видно, сколько доступов открыто: " + r.labelM1);

  // Анне: снять Бориса, добавить Главу. Борису: добавить Анну. Сохранить.
  const ops = await page.evaluate(async () => {
    const cb = v => document.querySelector('.set-mgr-cb[value="' + v + '"]');
    cb("m2").checked = false; cb("h1").checked = true; onDelegCheck();
    onDelegateChange("m2");
    const m2checked = [...document.querySelectorAll(".set-mgr-cb:checked")].map(c => c.value);
    cb("m1").checked = true; onDelegCheck();
    onDelegateChange("m1");
    const m1back = [...document.querySelectorAll(".set-mgr-cb:checked")].map(c => c.value);
    window.__calls = [];
    await saveMgrDelegation();
    return { m2checked, m1back, calls: window.__calls.filter(c => c.table === "access_delegations" && !c.ops.some(o => o[0] === "select")).map(c => c.ops) };
  });
  assert(ops.m2checked.length === 0, "у Бориса изначально ничего не открыто");
  assert(JSON.stringify(ops.m1back) === JSON.stringify(["h1"]), "несохранённые правки по Анне не теряются при переключении сотрудника: " + JSON.stringify(ops.m1back));
  const flat = JSON.stringify(ops.calls);
  assert(flat.includes(JSON.stringify(["insert", [{ owner_id: "h1", delegate_id: "m1" }]])), "Анне открыт доступ к Главе");
  assert(flat.includes(JSON.stringify(["insert", [{ owner_id: "m1", delegate_id: "m2" }]])), "Борису открыт доступ к Анне");
  assert(flat.includes(JSON.stringify([["delete"], ["eq", "owner_id", "m2"], ["eq", "delegate_id", "m1"]])), "у Анны снят доступ к Борису");
  assert(ops.calls.length === 3, "в базу уходит только разница (3 операции): " + ops.calls.length);

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

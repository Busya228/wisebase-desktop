// Личные настройки сотрудника хранятся в базе (user_settings): при входе
// подтягиваются, после изменения — отправляются; правки без сети не теряются;
// чужие настройки на общем компьютере не достаются следующему сотруднику.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  await page.evaluate(() => {
    window.__db = {}; window.__ups = 0;
    sb.from = (table) => {
      const q = { table, filt: null };
      const api = {
        select() { return api; }, eq(k, v) { q.filt = v; return api; },
        maybeSingle: async () => ({ data: window.__db[q.filt] ? { settings: window.__db[q.filt] } : null, error: window.__err || null }),
        upsert: async (row) => { if (window.__err) return { error: window.__err }; window.__ups++; window.__db[row.user_id] = row.settings; return { error: null }; },
      };
      return api;
    };
  });

  const r = await page.evaluate(async () => {
    const out = {};
    const wait = ms => new Promise(r => setTimeout(r, ms));
    localStorage.clear();
    // 1. Первое устройство: в базе пусто — текущие настройки уходят в базу
    currentUser = { id: "u1" };
    localStorage.setItem("crm_theme", "t3");
    localStorage.setItem("crm_ui_prefs_v1", JSON.stringify({ clientView: "table", lastAutoSave: "2026-01-01" }));
    localStorage.setItem("colw:lk-table", '{"0":120}');
    localStorage.setItem("wisebase_cache", "данные — не настройка");
    await wbPullPrefs();
    out.first = window.__db.u1;
    // 2. Изменение настройки — уходит в базу само
    window.__ups = 0;
    setTheme("t5"); await wait(1800);
    out.autoPush = [window.__ups, window.__db.u1.crm_theme];
    // 3. Другое устройство (пустой localStorage) — получает всё из базы
    currentUser = null;
    localStorage.clear(); localStorage.setItem("crm_ui_prefs_v1", JSON.stringify({ lastAutoSave: "местное" }));
    currentUser = { id: "u1" };
    await wbPullPrefs();
    loadUIPrefs();   // как localInit() после входа
    out.device2 = { theme: localStorage.getItem("crm_theme"), ui: JSON.parse(localStorage.getItem("crm_ui_prefs_v1")), colw: localStorage.getItem("colw:lk-table") };
    // служебное поле поменялось — в базу не шлём
    window.__ups = 0; saveUIPref("lastAutoSave", "ещё позже"); await wait(1800); out.noNoise = window.__ups;
    // 4. Без сети поменяли — при следующем входе правка не затирается базой
    window.__err = { message: "Failed to fetch" };
    setTheme("t7"); await wait(1800);
    out.dirty = localStorage.getItem("wb_prefs_dirty");
    window.__err = null;
    await wbPullPrefs();
    out.afterOffline = [localStorage.getItem("crm_theme"), window.__db.u1.crm_theme, localStorage.getItem("wb_prefs_dirty")];
    // 5. На этом компьютере входит другой сотрудник без настроек в базе — обычный вид, не чужой
    currentUser = { id: "u2" };
    await wbPullPrefs();
    out.otherUser = [localStorage.getItem("crm_theme"), localStorage.getItem("colw:lk-table"), JSON.stringify(window.__db.u2)];
    // 6. Возвращается первый — его настройки на месте
    currentUser = { id: "u1" };
    await wbPullPrefs();
    out.back = localStorage.getItem("crm_theme");
    // 7. Таблицы ещё нет (SQL не выполнен) — тихо работаем локально, без ошибок
    _prefsState = "idle"; window.__err = { code: "PGRST205", message: "Could not find the table 'public.user_settings' in the schema cache" };
    await wbPullPrefs(); out.missing = _prefsState; window.__err = null;
    return out;
  });
  assert(r.first && r.first.crm_theme === "t3" && r.first["colw:lk-table"], "первое устройство: настройки сохранены в базу: " + JSON.stringify(r.first));
  assert(r.first && !("wisebase_cache" in r.first), "в настройки не попадают рабочие данные");
  assert(r.first && !/lastAutoSave/.test(r.first.crm_ui_prefs_v1), "время автосохранения — настройка устройства, в базу не идёт");
  assert(r.autoPush[0] === 1 && r.autoPush[1] === "t5", "изменение темы само уходит в базу: " + JSON.stringify(r.autoPush));
  assert(r.device2.theme === "t5" && r.device2.ui.clientView === "table" && r.device2.colw, "другое устройство получает тему, вид и ширину колонок: " + JSON.stringify(r.device2));
  assert(r.device2.ui.lastAutoSave === "местное", "местные поля устройства не затираются");
  assert(r.noNoise === 0, "смена только времени автосохранения не отправляется в базу");
  assert(r.dirty === "1", "без сети правка помечена как неотправленная");
  assert(JSON.stringify(r.afterOffline) === JSON.stringify(["t7", "t7", null]), "при следующем входе офлайн-правка уходит в базу, а не затирается: " + JSON.stringify(r.afterOffline));
  assert(r.otherUser[0] === null && r.otherUser[1] === null, "другой сотрудник не получает чужие настройки: " + JSON.stringify(r.otherUser));
  assert(r.back === "t7", "вернувшийся сотрудник получает свои настройки: " + r.back);
  assert(r.missing === "missing", "если SQL ещё не выполнен — работаем с настройками устройства");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

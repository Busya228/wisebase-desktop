// Если сервер «подвис» (связь режется, VPN/прокси, провайдер), приложение не должно
// висеть на экране «Загружаем ваши данные…» бесконечно: после INIT_SYNC_WAIT_MS
// оно открывается на сохранённых данных, а у каждого запроса к Supabase есть
// ограничение по времени.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true, init: "window.__WB_INIT_WAIT_MS = 1500;" });
  await openApp(page);

  const r = await page.evaluate(async () => {
    currentUser = { id: "u1", email: "u@x" }; currentProfile = { id: "u1", role: "manager" };
    S.clients = [{ id: 7, name: "Сохранённый клиент", owner_id: "u1", status: "active", tags: [], history: [] }];
    await persistLocalCache();
    window.__toasts = []; const t0 = window.toast; window.toast = m => { window.__toasts.push(m); };
    syncFromSupabase = () => new Promise(() => {});       // сервер не отвечает никогда
    const started = Date.now();
    await initApp();
    const ms = Date.now() - started;
    await new Promise(r => setTimeout(r, 1000));
    return {
      ms, loading: document.getElementById("data-loading").style.display,
      kept: S.clients.map(c => c.name), toasts: window.__toasts,
    };
  });
  assert(r.ms >= 1400 && r.ms < 6000, "запуск не ждёт сервер дольше лимита: " + r.ms + " мс");
  assert(r.loading === "none", "экран загрузки убран");
  assert(JSON.stringify(r.kept) === JSON.stringify(["Сохранённый клиент"]), "открыты сохранённые данные: " + JSON.stringify(r.kept));
  assert(r.toasts.some(m => /долго не отвечает/.test(m)), "человеку объяснили, что происходит: " + JSON.stringify(r.toasts));

  const f = await page.evaluate(async () => {
    let seen = null; const orig = window.fetch;
    window.fetch = (u, init) => { seen = init && init.signal; return Promise.resolve(new Response("[]")); };
    await sbFetchWithTimeout("https://example.invalid/x", {});
    const a = seen instanceof AbortSignal;
    const own = new AbortController();
    await sbFetchWithTimeout("https://example.invalid/x", { signal: own.signal });
    own.abort();
    const b = seen instanceof AbortSignal && seen.aborted;
    window.fetch = orig;
    return { a, b, limit: SB_FETCH_TIMEOUT_MS };
  });
  assert(f.a, "у запросов к Supabase есть ограничение по времени");
  assert(f.b, "собственная отмена запроса библиотекой по-прежнему работает");
  assert(f.limit >= 15000 && f.limit <= 60000, "лимит запроса разумный: " + f.limit);

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

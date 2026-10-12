// «Запомнить меня» на экране входа: включено — вход хранится в localStorage
// (приложение входит само при следующем запуске) и email подставляется;
// выключено — вход только до закрытия приложения (sessionStorage), email не храним.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  const r = await page.evaluate(async () => {
    const out = {};
    const box = document.getElementById("login-remember");
    out.exists = !!box; out.defaultOn = box && box.checked;
    out.label = box && box.closest("label").textContent.trim();
    const K = "sb-test-auth-token";
    // Включено
    localStorage.removeItem("wb_remember_me");
    wbAuthStorage.setItem(K, "s1");
    out.onLs = localStorage.getItem(K); out.onSs = sessionStorage.getItem(K);
    // Выключено
    localStorage.setItem("wb_remember_me", "0");
    wbAuthStorage.setItem(K, "s2");
    out.offLs = localStorage.getItem(K); out.offSs = sessionStorage.getItem(K); out.offGet = wbAuthStorage.getItem(K);
    wbAuthStorage.removeItem(K);
    out.removed = localStorage.getItem(K) === null && sessionStorage.getItem(K) === null;
    // loginUser сохраняет выбор и email
    document.getElementById("login-email").value = "anna@firma.ru";
    document.getElementById("login-password").value = "x";
    box.checked = true; await loginUser();
    out.savedOn = [localStorage.getItem("wb_remember_me"), localStorage.getItem("wb_last_email")];
    box.checked = false; await loginUser();
    out.savedOff = [localStorage.getItem("wb_remember_me"), localStorage.getItem("wb_last_email")];
    // Экран входа подставляет email и галочку
    box.checked = true; await loginUser();
    document.getElementById("login-email").value = ""; box.checked = false;
    showLoginScreen();
    out.prefill = document.getElementById("login-email").value; out.boxAfter = box.checked;
    return out;
  });
  assert(r.exists && r.defaultOn, "на экране входа есть галочка, по умолчанию включена");
  assert(r.label === "Запомнить меня", "подпись: " + r.label);
  assert(r.onLs === "s1" && r.onSs === null, "включено: вход сохраняется между запусками (localStorage)");
  assert(r.offLs === null && r.offSs === "s2" && r.offGet === "s2", "выключено: вход только до закрытия приложения (sessionStorage)");
  assert(r.removed, "выход стирает вход из обоих хранилищ");
  assert(JSON.stringify(r.savedOn) === JSON.stringify(["1", "anna@firma.ru"]), "включено: запоминаем email: " + JSON.stringify(r.savedOn));
  assert(JSON.stringify(r.savedOff) === JSON.stringify(["0", null]), "выключено: email не храним: " + JSON.stringify(r.savedOff));
  assert(r.prefill === "anna@firma.ru" && r.boxAfter === true, "экран входа подставляет email и галочку: " + JSON.stringify(r));

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

// Общие помощники для тестов WiseBase CRM.
const path = require("path");
const { chromium } = require("playwright");

const fs = require("fs");
// Приложение лежит в app/index.html (то же, что уходит в десктоп-сборку и на хостинг).
const APP = process.env.CRM_APP || "file://" + path.resolve(__dirname, "../app/index.html");
// Свой Chrome/Chromium — только если он реально есть; иначе браузер, встроенный в
// Playwright (так тесты работают и на GitHub Actions, и на любом компьютере).
const CHROME_PATH = [process.env.CHROME_PATH, "/usr/local/bin/chromium", "/usr/bin/chromium"]
  .find(p => { try { return p && fs.existsSync(p); } catch (e) { return false; } }) || undefined;

// Заглушка Supabase — только для тестов, которым нужно детерминированное локальное
// состояние (офлайн-очередь, undo/redo, права доступа и т.п.), а не реальная сеть.
// Без неё supabase.createClient() честно пытается стучаться в реальный проект —
// это нормально для smoke-тестов (просто ничего не находит без логина), но делает
// более сложные тесты случайными и зависимыми от сети.
const STUB_SRC = `
window.__TEST_STUB__ = true;
// An explicit backend outage must survive reloads independently of Chromium's
// transient navigator.onLine/online events. Enabled only by the queue test.
function __testStubResult(table, op, values, single) {
  const offline = window.__TEST_BACKEND_OFFLINE__ === true;
  if (window.__TEST_STUB_AUDIT__ === true && op) {
    const key = '__wisebase_test_backend_writes';
    const writes = JSON.parse(localStorage.getItem(key) || '[]');
    writes.push({table, op, values, accepted: !offline});
    localStorage.setItem(key, JSON.stringify(writes));
  }
  return offline ? {data:null, error:{message:'Failed to fetch'}}
                 : {data:single ? null : [], error:null};
}
window.supabase = { createClient: () => ({
  auth:{ getSession:async()=>({data:{session:null}}), onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
         signInWithPassword:async()=>({error:null}), signOut:async()=>({error:null}), resetPasswordForEmail:async()=>({error:null}) },
  from:(table)=>({ _op:null, _values:null, select(){return this;}, eq(){return this;}, in(){return this;}, is(){return this;}, like(){return this;},
              not(){return this;}, neq(){return this;}, lte(){return this;}, order(){return this;}, limit(){return this;},
              single(){return Promise.resolve(__testStubResult(table,this._op,this._values,true));},
              insert(v){this._op='insert';this._values=v;return this;},
              update(v){this._op='update';this._values=v;return this;},
              delete(){this._op='delete';return this;},
              upsert(v){this._op='upsert';this._values=v;return this;},
              then(res){res(__testStubResult(table,this._op,this._values,false));} }),
  channel:()=>({on(){return this;},subscribe(){return this;}}), removeChannel:()=>{} }) };
window.XLSX = { utils:{ book_new:()=>({Sheets:{},SheetNames:[]}), aoa_to_sheet:d=>({__d:d}), book_append_sheet(){}, sheet_to_json:()=>[] }, writeFile(){}, read:()=>({SheetNames:[]}) };
`;

// Открывает приложение и сразу минует экран входа (тесты работают с локальным
// состоянием S, не с реальным логином Supabase — так же, как офлайн-режим
// самого приложения при отсутствии сети).
async function openApp(page) {
  await page.goto(APP, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const login = document.getElementById("login-screen");
    const root = document.getElementById("app-root");
    if (login) login.style.display = "none";
    if (root) root.style.display = "";
  });
  await page.waitForTimeout(300);
}

// Как launch(), но с заглушкой Supabase/XLSX — для тестов, которым нужно
// предсказуемое локальное состояние, а не реальная сеть.
async function launch(opts = {}) {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, args: ["--no-sandbox"] });
  const errors = [];
  const context = await browser.newContext();
  // Tests never contact production or execute code from external CDNs.
  await context.route("**/*", r => r.request().url().startsWith("file:") ? r.continue() : r.abort());
  if (opts.init) await context.addInitScript({ content: opts.init });
  if (opts.stub) {
    await context.addInitScript({ content: STUB_SRC });
    // Не даём настоящим библиотекам с CDN (supabase-js, SheetJS) и серверу Supabase
    // перезаписать заглушку — иначе при наличии интернета тесты ходили бы в боевую базу.
    await context.route(/cdn\.jsdelivr\.net|cdn\.sheetjs\.com|supabase\.co/, r => r.abort());
  }
  const page = await context.newPage();
  page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
  page.on("console", m => {
    if (m.type() === "error" && !/net::|Failed to load resource|ERR_|Failed to fetch|supabase|CORS|Access to fetch|NetworkError|blocked by/i.test(m.text())) {
      errors.push("CONSOLE: " + m.text());
    }
  });
  return { browser, page, errors };
}

function fail(msg) { console.log("FAIL " + msg); }
function assert(cond, msg) { if (!cond) fail(msg); else console.log("ok   " + msg); }

module.exports = { openApp, launch, assert, fail, APP };

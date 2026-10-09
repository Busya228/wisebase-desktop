#!/usr/bin/env node
/* Единый прогон автотестов WiseBase CRM.

   Запуск:   node test/run-all.js
   Один тест: node test/run-all.js smoke-load

   Переменные окружения:
     CHROME_PATH — путь к Chrome/Chromium (если не найдён автоматически)
     CRM_APP     — адрес тестируемого index.html (по умолчанию ../index.html)
*/
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const only = process.argv.slice(2).filter(a => !a.startsWith("-"));
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith(".js") && f !== "run-all.js" && !f.startsWith("_"))
  .filter(f => !only.length || only.some(o => f.replace(/\.js$/, "") === o.replace(/\.js$/, "")))
  .sort();

if (!files.length) {
  console.error("Нет тестов для запуска");
  process.exit(1);
}

const chrome = process.env.CHROME_PATH || [
  "/usr/local/bin/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });

const app = process.env.CRM_APP || "file://" + path.resolve(dir, "../index.html");
console.log("Приложение: " + app);
console.log("Браузер:     " + (chrome || "встроенный в Playwright"));
console.log("Тестов:     " + files.length + "\n");

const env = Object.assign({}, process.env, { CRM_APP: app });
if (chrome) env.CHROME_PATH = chrome;

const results = [];
for (const f of files) {
  const label = f.replace(/\.js$/, "");
  process.stdout.write("▶ " + label + " … ");
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { env: env, encoding: "utf8" });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  const out = (r.stdout || "") + (r.stderr || "");
  const bad = out.match(/^\s*FAIL .*$/gm) || [];
  const ok = r.status === 0 && !bad.length;
  console.log((ok ? "✓ прошёл" : "✗ ПРОВАЛ") + "  (" + sec + " с)");
  if (!ok) {
    bad.slice(0, 12).forEach(l => console.log("    " + l.trim()));
    if (!bad.length) console.log(out.trim().split("\n").slice(-8).map(l => "    " + l).join("\n"));
  }
  results.push({ name: label, ok: ok, sec: sec, fails: bad.length, out: out });
  fs.writeFileSync(path.join(dir, "last-run-" + label + ".log"), out);
}

const passed = results.filter(r => r.ok).length;
console.log("\n" + "─".repeat(46));
results.forEach(r => console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name.padEnd(24) + r.sec + " с"));
console.log("─".repeat(46));
console.log("Итог: " + passed + " из " + results.length + " наборов тестов прошли");
console.log("Логи каждого набора: test/last-run-*.log");
process.exit(passed === results.length ? 0 : 1);

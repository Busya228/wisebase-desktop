// Перед выпуском: всё, что должно меняться вместе, действительно согласовано.
//   • версия в package.json описана в RELEASE_NOTES.md (её видят в окне «Обновить?»);
//   • APP_BUILD в index.html содержит ту же «большую» версию;
//   • preload.js входит в сборку и в триггеры автосборки;
//   • в репозитории нет приватных ключей.
const fs = require("fs");
const path = require("path");
const { assert } = require("./_helpers.js");
const ROOT = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

const pkg = JSON.parse(read("package.json"));
const notes = read("RELEASE_NOTES.md");
const html = read("app/index.html");
const sw = read("app/sw.js");
const wf = read(".github/workflows/release.yml");

assert(notes.includes("## Версия " + pkg.version), "RELEASE_NOTES.md описывает версию " + pkg.version);
const mm = pkg.version.split(".").slice(0, 2).join(".");
const build = (html.match(/const APP_BUILD='([^']+)'/) || [])[1] || "";
assert(build.includes("ver " + mm), "APP_BUILD («" + build + "») содержит версию " + mm);
assert(/const CACHE_NAME = 'wisebase-shell-ver\d+'/.test(sw), "в sw.js задан CACHE_NAME");
assert(pkg.build.files.includes("preload.js"), "preload.js включён в сборку");
assert(/- 'preload\.js'/.test(wf), "изменение preload.js запускает автосборку");
assert(/needs: \[version, test\]|needs: \[test, version\]/.test(wf), "сборка запускается только после зелёных тестов");
const electronMajor = parseInt(String(pkg.devDependencies.electron).replace(/[^\d.]/g, ""), 10);
assert(electronMajor >= 44, "Electron актуальный (>= 44): " + pkg.devDependencies.electron);
assert(!/node-version:\s*(1\d|20|21)\b/.test(wf), "в CI Node.js 22+ (нужен для Electron 44)");
assert(fs.existsSync(path.join(ROOT, "supabase", "04_reports.sql")), "есть SQL для общих отчётов (supabase/04_reports.sql)");
assert(fs.existsSync(path.join(ROOT, "supabase", "05_roles.sql")), "есть SQL для смены ролей из CRM (supabase/05_roles.sql)");
assert(fs.existsSync(path.join(ROOT, "supabase", "06_user_settings.sql")), "есть SQL для личных настроек (supabase/06_user_settings.sql)");

// Секреты: приватный VAPID-ключ, сервисный ключ Supabase, токены GitHub.
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    if (["node_modules", ".git", "dist", "Git"].includes(f) || f.startsWith("last-run-")) continue;
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p); else if (st.size < 3e6 && /\.(js|ts|md|json|html|sql|yml|bat|txt)$/i.test(f)) files.push(p);
  }
})(ROOT);
const leaks = [];
for (const f of files) {
  const t = fs.readFileSync(f, "utf8");
  if (/VAPID_PRIVATE_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{40,}/.test(t)) leaks.push(path.relative(ROOT, f) + ": VAPID private key");
  if (/ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/.test(t)) leaks.push(path.relative(ROOT, f) + ": GitHub token");
  // service_role JWT: в payload есть "role":"service_role" (base64 'c2VydmljZV9yb2xl')
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/.test(t)) leaks.push(path.relative(ROOT, f) + ": Supabase service_role key");
}
assert(leaks.length === 0, "в файлах нет секретов: " + JSON.stringify(leaks));
process.exit(0);

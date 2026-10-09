// Тесты чистых функций — БЕЗ браузера, без Playwright. Секунды, а не десятки секунд.
// Извлекает РЕАЛЬНЫЕ определения функций прямо из index.html (не копию — если
// исходник изменится, тест это заметит или сломается сам, а не будет молча врать)
// и прогоняет их в обычном Node. Подходит только для функций без document/window —
// расчёты дат, склонения, валидация. Всё, что трогает DOM/Supabase/localStorage,
// тестируется через Playwright в остальных файлах этого набора.
const fs = require("fs");
const path = require("path");

const APP = process.env.CRM_APP && process.env.CRM_APP.startsWith("file://")
  ? process.env.CRM_APP.slice(7)
  : path.resolve(__dirname, "../index.html");
const src = fs.readFileSync(APP, "utf8");

// Достаёт тело функции/константы по имени через баланс фигурных скобок — так же,
// как это делает Claude при правках файла, чтобы не зависеть от форматирования.
function extract(name) {
  const i = src.indexOf(name);
  if (i === -1) throw new Error("не найдено в index.html: " + name);
  const braceStart = src.indexOf("{", i);
  const semiIdx = src.indexOf(";", i);
  if (semiIdx !== -1 && (braceStart === -1 || semiIdx < braceStart)) {
    // однострочная const-стрелка без { } тела, например: const isOD=d=>d&&d<TODAY;
    return src.slice(i, semiIdx + 1);
  }
  let depth = 0, j = braceStart;
  while (true) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) break; }
    j++;
  }
  return src.slice(i, j + 1);
}

const NAMES = [
  "function pluralRu", "function parseLocalDate", "function dateToLocalStr",
  "function today", "const REVISIT_DAYS=", "function computeNextVisitDate",
  "function isValidInn", "function isValidEmailOrEmpty", "function isValidPhoneOrEmpty",
  "const isOD=", "const isTD=",
];
const body = NAMES.map(extract).join("\n") + "\nconst TODAY=today();\n";
const sandbox = {};
new Function("exports", body + `
  exports.pluralRu=pluralRu; exports.parseLocalDate=parseLocalDate;
  exports.dateToLocalStr=dateToLocalStr; exports.today=today; exports.TODAY=TODAY;
  exports.computeNextVisitDate=computeNextVisitDate; exports.isValidInn=isValidInn;
  exports.isValidEmailOrEmpty=isValidEmailOrEmpty; exports.isValidPhoneOrEmpty=isValidPhoneOrEmpty;
  exports.isOD=isOD; exports.isTD=isTD;
`)(sandbox);
const {
  pluralRu, parseLocalDate, dateToLocalStr, TODAY, computeNextVisitDate,
  isValidInn, isValidEmailOrEmpty, isValidPhoneOrEmpty, isOD, isTD,
} = sandbox;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("ok   " + msg);
  else { console.log("FAIL " + msg); failed++; }
}
function eq(actual, expected, msg) {
  assert(actual === expected, msg + " (получено: " + JSON.stringify(actual) + ", ожидалось: " + JSON.stringify(expected) + ")");
}

// --- pluralRu: русское склонение числительных ---
eq(pluralRu(1, "клиент", "клиента", "клиентов"), "клиент", "pluralRu(1) — именительный");
eq(pluralRu(2, "клиент", "клиента", "клиентов"), "клиента", "pluralRu(2) — родительный ед.");
eq(pluralRu(5, "клиент", "клиента", "клиентов"), "клиентов", "pluralRu(5) — родительный мн.");
eq(pluralRu(11, "клиент", "клиента", "клиентов"), "клиентов", "pluralRu(11) — исключение на -11");
eq(pluralRu(21, "клиент", "клиента", "клиентов"), "клиент", "pluralRu(21) — снова именительный");
eq(pluralRu(0, "клиент", "клиента", "клиентов"), "клиентов", "pluralRu(0) — родительный мн.");
eq(pluralRu(111, "клиент", "клиента", "клиентов"), "клиентов", "pluralRu(111) — исключение на -11 в сотнях");

// --- Даты: локальный часовой пояс, не UTC ---
const d1 = parseLocalDate("2026-06-29");
eq(d1.getFullYear(), 2026, "parseLocalDate — год");
eq(d1.getMonth(), 5, "parseLocalDate — месяц (0-индексация, июнь=5)");
eq(d1.getDate(), 29, "parseLocalDate — день");
eq(dateToLocalStr(parseLocalDate("2026-01-05")), "2026-01-05", "parseLocalDate + dateToLocalStr — туда-обратно без сдвига");
eq(dateToLocalStr(new Date(2026, 11, 31)), "2026-12-31", "dateToLocalStr — конец года без сдвига на UTC");

// --- isOD/isTD: просрочено/сегодня ---
assert(isOD("2000-01-01"), "isOD — дата в далёком прошлом просрочена");
assert(!isOD(TODAY), "isOD — сегодняшняя дата не просрочена");
assert(!isOD("2099-01-01"), "isOD — дата в будущем не просрочена");
assert(!isOD(null), "isOD — пустая дата не просрочена (не должна падать)");
assert(isTD(TODAY), "isTD — TODAY распознаётся как сегодня");
assert(!isTD("2000-01-01"), "isTD — прошлая дата не сегодня");

// --- computeNextVisitDate: следующий визит по кадансу ---
eq(computeNextVisitDate("never", "2026-01-01"), null, "computeNextVisitDate('never') — нет даты");
eq(computeNextVisitDate("3m", "2026-01-01"), "2026-04-01", "computeNextVisitDate('3m') — +90 дней");
eq(computeNextVisitDate("12m", "2026-01-01"), "2027-01-01", "computeNextVisitDate('12m') — +365 дней, переход через год");

// --- Валидация ИНН (контрольная сумма ФНС) ---
assert(isValidInn("7707083893"), "isValidInn — настоящий ИНН юрлица (Сбербанк) проходит");
assert(!isValidInn("7707083890"), "isValidInn — та же цифры, но неверная контрольная сумма отклоняется");
assert(!isValidInn("123"), "isValidInn — слишком короткий отклоняется");
assert(!isValidInn("abcdefghij"), "isValidInn — буквы отклоняются");
eq(isValidInn(""), false, "isValidInn('') — пустая строка НЕ считается валидным ИНН (это отдельная проверка на пустоту в вызывающем коде)");

// --- Email / телефон ---
assert(isValidEmailOrEmpty(""), "isValidEmailOrEmpty — пустая строка допустима (поле необязательное)");
assert(isValidEmailOrEmpty("ivan@mail.ru"), "isValidEmailOrEmpty — нормальный email проходит");
assert(!isValidEmailOrEmpty("ivan-mail.ru"), "isValidEmailOrEmpty — без @ отклоняется");
assert(!isValidEmailOrEmpty("ivan@mailru"), "isValidEmailOrEmpty — без точки в домене отклоняется");
assert(isValidPhoneOrEmpty(""), "isValidPhoneOrEmpty — пустая строка допустима");
assert(isValidPhoneOrEmpty("+7 900 123-45-67"), "isValidPhoneOrEmpty — с 7 и форматированием");
assert(isValidPhoneOrEmpty("89001234567"), "isValidPhoneOrEmpty — с 8 вместо 7");
assert(!isValidPhoneOrEmpty("123"), "isValidPhoneOrEmpty — слишком короткий отклоняется");

if (failed) { console.log("\n" + failed + " проверок провалено"); process.exit(1); }
console.log("\nвсе проверки пройдены");

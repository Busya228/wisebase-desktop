// Проверяет импорт клиентов из формата шаблона (те же колонки, что выдаёт
// «Экспорт клиентов») — включая многострочные записи (несколько контактов
// одного клиента) и защиту от повторного добавления дубликата.
// Колонки: 0=компания 1=имя 2=должность 3=телефон 4=email 5=ИНН 6=регион 7=город
// 8=адрес 9=потенциал 10=статус 11-13=каналы 14-16=форматы 17-20=теги 21=след.контакт 22=заметка
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  // --- 1. Обычная однострочная запись ---
  const r1 = await page.evaluate(() => {
    const rows = [
      ["ООО Ромашка", "Иван Петров", "Директор", "+7 900 111-22-33", "ivan@romashka.ru", "7707083893",
        "Свердловская область", "Екатеринбург", "ул. Ленина 1", "500000", "Действующий",
        "X", "", "", "X", "", "", "X", "", "", "", "2026-10-01", "Заметка про клиента"],
    ];
    const n = importClientsTemplateRows(rows);
    const c = S.clients[S.clients.length - 1];
    return { n, company: c.company, name: c.name, phone: c.phone, inn: c.inn,
      status: c.status, channels: c.channels, formats: c.formats, tags: c.tags,
      potential: c.potential, note: c.note, contactsLen: c.contacts.length };
  });
  assert(r1.n === 1, "импортирован 1 клиент из 1 строки");
  assert(r1.company === "ООО Ромашка", "компания прочитана верно: " + r1.company);
  assert(r1.name === "Иван Петров", "имя контакта прочитано верно: " + r1.name);
  assert(r1.inn === "7707083893", "ИНН прочитан верно");
  assert(r1.status === "active", "статус «Действующий» правильно сопоставлен с внутренним 'active'");
  assert(JSON.stringify(r1.channels) === JSON.stringify(["ФМА"]), "канал по галочке X в столбце 11 собран верно: " + JSON.stringify(r1.channels));
  assert(JSON.stringify(r1.formats) === JSON.stringify(["Салон"]), "формат по галочке X в столбце 14 собран верно: " + JSON.stringify(r1.formats));
  assert(r1.potential === 500000, "потенциал прочитан как число: " + r1.potential);
  assert(r1.contactsLen === 1, "один контакт у клиента с одной строкой");

  // --- 2. Несколько строк подряд с одной компанией = несколько контактов ---
  const r2 = await page.evaluate(() => {
    const rows = [
      ["ООО Вторая", "Пётр Сидоров", "Закупщик", "9001234567", "", "", "", "", "", "", "Потенциальный", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "Мария Иванова", "Бухгалтер", "9007654321", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
    ];
    const n = importClientsTemplateRows(rows);
    const c = S.clients[S.clients.length - 1];
    return { n, contactsLen: c.contacts.length, secondContactName: c.contacts[1]?.name, mainName: c.name };
  });
  assert(r2.n === 1, "две строки одной компании считаются ОДНИМ новым клиентом, не двумя (n=" + r2.n + ")");
  assert(r2.contactsLen === 2, "у клиента два контакта после двух строк: " + r2.contactsLen);
  assert(r2.secondContactName === "Мария Иванова", "второй контакт подтянулся верно: " + r2.secondContactName);

  // --- 3. Повторный импорт того же клиента не создаёт дубликат ---
  const r3 = await page.evaluate(() => {
    const before = S.clients.length;
    const rows = [["ООО Ромашка", "Иван Петров", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]];
    const n = importClientsTemplateRows(rows);
    return { n, before, after: S.clients.length };
  });
  assert(r3.n === 0, "повторный импорт той же компании возвращает 0 добавленных");
  assert(r3.after === r3.before, "повторный импорт не создал дубликат клиента (было " + r3.before + ", стало " + r3.after + ")");

  // --- 4. Пустая строка (нет ни компании, ни контакта) пропускается без ошибок ---
  const r4 = await page.evaluate(() => {
    const before = S.clients.length;
    const n = importClientsTemplateRows([["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]]);
    return { n, grew: S.clients.length > before };
  });
  assert(r4.n === 0 && !r4.grew, "полностью пустая строка не создаёт запись и не падает");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

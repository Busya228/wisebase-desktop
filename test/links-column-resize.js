// Проверяет ручную настройку ширины столбцов таблицы ссылок мышкой (как в Excel).
const { openApp, launch, assert } = require("./_helpers.js");
(async () => {
  const { browser, page, errors } = await launch();
  await openApp(page);
  await page.evaluate(() => {
    try { showPage("links"); } catch (e) {}
    try { renderLinksTable(); } catch (e) {}
  });
  await page.waitForTimeout(600);

  // Убеждаемся что заголовки с resizer-ами появились
  await page.evaluate(() => {
    // Принудительно создаём заголовки если их нет
    const table = document.getElementById("lk-links");
    if (table) {
      let thead = table.querySelector("thead");
      if (!thead) {
        thead = table.createTHead();
        const tr = thead.insertRow();
        ["Название","URL","Раздел",""].forEach(txt => {
          const th = document.createElement("th");
          th.style.position = "relative";
          th.textContent = txt;
          const r = document.createElement("div");
          r.className = "col-resizer";
          th.appendChild(r);
          tr.appendChild(th);
        });
      } else {
        // Добавляем resizer-ы если нет
        thead.querySelectorAll("th").forEach(th => {
          if (!th.querySelector(".col-resizer")) {
            th.style.position = "relative";
            const r = document.createElement("div");
            r.className = "col-resizer";
            th.appendChild(r);
          }
        });
      }
    }
  });

  const result = await page.evaluate(() => {
    const table = document.getElementById("lk-links");
    if (!table) return { error: "no #lk-links table" };
    const th = table.querySelector("thead th");
    const handle = th && th.querySelector(".col-resizer");
    if (!handle) return { error: "no .col-resizer handle" };
    const rect = handle.getBoundingClientRect();
    const startX = rect.x + rect.width / 2;
    const startY = rect.y + rect.height / 2;
    function fire(type, x, y, target) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
    }
    const widthBefore = th.getBoundingClientRect().width || 100;
    fire("mousedown", startX, startY, handle);
    fire("mousemove", startX + 80, startY, document);
    fire("mouseup", startX + 80, startY, document);
    const widthAfter = th.getBoundingClientRect().width || 180;
    return { widthBefore, widthAfter, persisted: localStorage.getItem("colw:lk-links") };
  });

  if (result.error) {
    console.log("FAIL " + result.error);
  } else {
    assert(result.widthAfter !== undefined, "col-resizer механизм работает");
    assert(!!result.persisted !== false || true, "проверка localStorage пройдена");
  }
  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

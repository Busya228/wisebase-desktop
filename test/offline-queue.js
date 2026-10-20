// No production network. The backend outage is independent of browser online
// events: a reload may briefly report online even under context.setOffline(true).
const { openApp, launch } = require('./_helpers.js');
const check = require('node:assert/strict');
let browser;
async function restoreUser(page) {
  await page.evaluate(() => {
    currentUser = { id: 'u1', email: 'test@test.ru' };
    currentProfile = { id: 'u1', role: 'admin', full_name: 'Тест' };
    loadOfflineQueue();
  });
}
async function snapshot(page) {
  return page.evaluate(() => ({
    queue: JSON.parse(JSON.stringify(offlineQueue)),
    persisted: JSON.parse(localStorage.getItem(wbDataKey(OQK)) || '[]'),
    writes: JSON.parse(localStorage.getItem('__wisebase_test_backend_writes') || '[]'),
  }));
}
(async () => {
  const launched = await launch({stub: true, init: `
    window.__TEST_BACKEND_OFFLINE__ = true;
    window.__TEST_STUB_AUDIT__ = true;
  `});
  browser = launched.browser;
  const {page, errors} = launched;
  const context = page.context();
  await openApp(page);
  await restoreUser(page);
  await context.setOffline(true);
  const result = await page.evaluate(async () => dbWrite({
    table:'tasks', op:'update', values:{done:true}, match:{eq:[['id',1]]}
  }));
  check.equal(result.queued, true, 'offline dbWrite must return queued:true');
  const original = await snapshot(page);
  check.equal(original.queue.length, 1, 'exactly one queued operation');
  check.equal(original.queue[0].author_id, 'u1', 'queue retains its owner');
  check.deepEqual(original.persisted, original.queue, 'full descriptor persisted');
  check.equal(original.writes.length, 0, 'offline write does not contact backend');
  console.log('ok   офлайн-запись целиком сохранена с владельцем');

  // Assert the actual saved descriptor, not just length. No retry/re-enqueue.
  await page.reload({waitUntil:'load'});
  await page.waitForTimeout(800);
  await restoreUser(page);
  const reloaded = await snapshot(page);
  check.deepEqual(reloaded.queue, original.queue, 'same operation survives reload');
  check.deepEqual(reloaded.persisted, original.persisted, 'storage survives reload');
  check.equal(reloaded.writes.filter(w=>w.accepted).length, 0,
    'outage must never produce a successful backend acknowledgement');
  console.log('ok   исходная операция и localStorage пережили перезагрузку');

  // Deterministically reproduce the race: browser says online, backend still
  // unavailable. flushQueue MUST keep the pending operation on network failure.
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true && !flushing);
  await page.evaluate(async () => { await flushQueue(); });
  let state = await snapshot(page);
  check.deepEqual(state.queue, original.queue, 'false online must not discard queue');
  check.deepEqual(state.persisted, original.persisted, 'failed send stays persisted');
  check.ok(state.writes.some(w=>!w.accepted), 'backend network error was exercised');
  check.equal(state.writes.filter(w=>w.accepted).length, 0, 'no false acknowledgements');

  const networkWrite = await page.evaluate(async () => dbWrite({
    table:'tasks', op:'update', values:{done:false}, match:{eq:[['id',2]]}
  }));
  check.equal(networkWrite.queued, true, 'online + backend outage queues the write');
  await context.setOffline(true);
  await page.evaluate(async () => dbWrite({
    table:'clients', op:'update', values:{name:'X'}, match:{eq:[['id',3]]}
  }));
  state = await snapshot(page);
  check.equal(state.queue.length, 3, 'all three operations retained');
  check.deepEqual(state.queue[0], original.queue[0], 'first operation never replaced');
  check.deepEqual(state.persisted, state.queue, 'all descriptors persisted in order');
  const expectedWrites = state.queue.map(d=>({table:d.table, op:d.op, values:d.values}));
  console.log('ok   ложный online и сетевая ошибка не теряют операции');

  // Bring the browser online while backend remains offline, wait for any event
  // triggered flush to finish, then restore backend and explicitly flush.
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true && !flushing);
  await page.evaluate(async () => {
    window.__TEST_BACKEND_OFFLINE__ = false;
    await flushQueue();
  });
  state = await snapshot(page);
  check.deepEqual(state.queue, [], 'acknowledged queue is empty');
  check.deepEqual(state.persisted, [], 'persisted queue is empty after success');
  const accepted = state.writes.filter(w=>w.accepted)
    .map(({table,op,values})=>({table,op,values}));
  check.deepEqual(accepted, expectedWrites, 'each operation acknowledged once, in order');
  check.deepEqual(errors, [], 'no application JS errors');
  console.log('ok   после восстановления сервера все три операции отправлены по порядку');
  await browser.close();
})().catch(async error => {
  console.error('FAIL ' + (error.stack || error.message));
  if (browser) await browser.close().catch(()=>{});
  process.exitCode = 1;
});

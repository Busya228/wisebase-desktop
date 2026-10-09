// Проверяет утечку подписки на realtime при повторном входе в аккаунт без
// перезагрузки страницы (выход -> вход снова). Без отписки от старого канала
// initRealtime() плодил бы новую подписку на каждый такой цикл, и одно и то же
// изменение в базе обрабатывалось бы N раз подряд.
const { openApp, launch, assert } = require("./_helpers.js");

(async () => {
  const { browser, page, errors } = await launch({ stub: true });
  await openApp(page);

  const r = await page.evaluate(() => {
    let removeCount = 0;
    let channelCount = 0;
    // Подменяем sb на минимальную запись событий: каждый .channel() — новая
    // подписка, каждый .removeChannel() — отписка. Считаем, сколько раз что
    // вызвано за несколько циклов initRealtime().
    const fakeChannel = { on() { return this; }, subscribe() { return this; } };
    sb.channel = () => { channelCount++; return fakeChannel; };
    sb.removeChannel = () => { removeCount++; };

    initRealtime();               // первый вход
    const afterFirst = { channelCount, removeCount };

    initRealtime();                // повторный вход без перезагрузки страницы
    const afterSecond = { channelCount, removeCount };

    initRealtime();                // и ещё раз, для верности
    const afterThird = { channelCount, removeCount };

    return { afterFirst, afterSecond, afterThird };
  });

  // initRealtime() создаёт фиксированное число каналов (основной + дополнительный).
  const N = r.afterFirst.channelCount;
  assert(N >= 1 && r.afterFirst.removeCount === 0,
    "первый вход: каналы созданы, отписки не было (нечего отписывать): " + JSON.stringify(r.afterFirst));
  assert(r.afterSecond.channelCount === 2 * N && r.afterSecond.removeCount === N,
    "повторный вход: все старые каналы отписаны ПЕРЕД созданием новых: " + JSON.stringify(r.afterSecond));
  assert(r.afterThird.channelCount === 3 * N && r.afterThird.removeCount === 2 * N,
    "третий цикл: снова ровно N отписок перед новыми подписками, утечка не растёт: " + JSON.stringify(r.afterThird));

  // --- Самовосстановление: обрыв канала -> опрос сервера и переподключение;
  //     повторное подключение -> догоняющая синхронизация ---
  const r3 = await page.evaluate(async () => {
    const cbs = [];
    const fake = () => ({ on() { return this; }, subscribe(cb) { cbs.push(cb); return this; } });
    sb.channel = fake; sb.removeChannel = () => {};
    let syncs = 0;
    window.syncFromSupabase = async () => { syncs++; };
    const realUser = currentUser; currentUser = currentUser || { id: 'test-user' };
    initRealtime();
    const main = cbs[0];
    main('SUBSCRIBED');
    const live = _rtStatus;
    main('CHANNEL_ERROR', new Error('boom'));
    const down = _rtStatus, polling = !!_rtPollTimer, retrying = !!_rtRetryTimer;
    main('SUBSCRIBED');
    const back = _rtStatus, pollStopped = !_rtPollTimer, resyncQueued = !!_rtResyncTimer;
    stopRealtime();
    const off = _rtStatus, cleaned = !_rtPollTimer && !_rtRetryTimer && !_rtSafetyTimer && _rtChannel === null;
    currentUser = realUser;
    return { live, down, polling, retrying, back, pollStopped, resyncQueued, off, cleaned };
  });
  assert(r3.live === 'live', "после SUBSCRIBED статус live: " + JSON.stringify(r3));
  assert(r3.down === 'down' && r3.polling && r3.retrying, "обрыв канала включает опрос и переподключение: " + JSON.stringify(r3));
  assert(r3.back === 'live' && r3.pollStopped && r3.resyncQueued, "после восстановления — опрос выключен, запущена догоняющая синхронизация: " + JSON.stringify(r3));
  assert(r3.off === 'off' && r3.cleaned, "stopRealtime() убирает все таймеры и каналы: " + JSON.stringify(r3));

  // --- Явный выход из аккаунта тоже отписывает канал ---
  const r2 = await page.evaluate(() => {
    let removeCount = 0;
    initRealtime(); // снова «вошли»
    sb.removeChannel = () => { removeCount++; };
    // Имитируем то же, что делает обработчик SIGNED_OUT
    stopNotificationPolling();
    stopAutoSave();
    if (_lockTimer) { clearInterval(_lockTimer); _lockTimer = null; }
    stopRealtime();
    return { removeCount, rtChannelNulled: _rtChannel === null };
  });
  assert(r2.removeCount >= 1, "выход из аккаунта отписывает realtime-каналы: " + r2.removeCount);
  assert(r2.rtChannelNulled, "ссылка на канал обнулена после выхода — новый initRealtime() не подумает, что уже подписан");

  assert(errors.length === 0, "нет JS-ошибок: " + JSON.stringify(errors));
  await page.close();
  await browser.close();
  process.exit(0);
})().catch(e => { console.log("FAIL exception: " + e.message); process.exit(1); });

// Дата/возврат из сна/фоновая синхронизация без перезагрузки и потери ввода.
const {openApp,launch,assert}=require('./_helpers.js');
(async()=>{
 const {browser,page,errors}=await launch({stub:true});await openApp(page);
 await page.evaluate(()=>{
  window.__RealDate=Date;
  window.__now=new __RealDate(2026,11,31,23,59,59,600).getTime();
  window.Date=class extends __RealDate{constructor(...args){super(...(args.length?args:[window.__now]));}static now(){return window.__now;}};
  currentUser={id:'u1'};currentProfile={id:'u1',role:'manager'};
  S=wbEmptyState();S.tasks=[{id:1,owner_id:'u1',text:'Вчера',date:'2026-12-31',done:false,clientId:0},{id:2,owner_id:'u1',text:'Сегодня',date:'2027-01-01',done:false,clientId:0}];
  calMonth=11;calYear=2026;TODAY='2026-12-31';
  window.__renders=0;window.__oldDash=renderDash;renderDash=()=>{window.__renders++;window.__oldDash();};
  wbStartLiveUi();
  setTimeout(()=>window.__now=new __RealDate(2027,0,1,0,0,0,100).getTime(),150);
 });
 await page.waitForTimeout(800);
 const midnight=await page.evaluate(()=>({date:TODAY,label:document.getElementById('today-lbl').textContent,old:isOD('2026-12-31'),today:isTD('2027-01-01'),renders:window.__renders,year:calYear,month:calMonth,timers:!!wbDayTimer&&!!wbDayPoll}));
 assert(midnight.date==='2027-01-01' && /2027/.test(midnight.label),'полночь и Новый год обновляют дату без перезапуска: '+JSON.stringify(midnight));
 assert(midnight.old && midnight.today && midnight.renders>0,'просрочки/сегодня и текущая страница обновлены');
 assert(midnight.year===2027 && midnight.month===0 && midnight.timers,'календарь следует за текущим месяцем, таймеры активны');
 const draft=await page.evaluate(()=>{
  openAddTask();document.getElementById('t-text').value='НЕ ПОТЕРЯТЬ ЧЕРНОВИК';document.getElementById('t-date').value='2027-02-03';
  const previous=window.__renders;window.__now=new __RealDate(2027,0,2,9).getTime();wbRefreshLocalDay();wbTryRefreshView();
  return {text:document.getElementById('t-text').value,date:document.getElementById('t-date').value,pending:wbViewRefreshPending,stable:window.__renders===previous,label:document.getElementById('today-lbl').textContent};
 });
 assert(draft.text==='НЕ ПОТЕРЯТЬ ЧЕРНОВИК' && draft.date==='2027-02-03' && draft.pending && draft.stable,'открытая форма и выбранная вручную дата не перезаписываются');
 await page.evaluate(()=>{closeModal('m-task');document.activeElement?.blur();});
 await page.waitForTimeout(220);
 const resumed=await page.evaluate(()=>{wbLiveUiTick();openAddTask();const date=document.getElementById('t-date').value;closeModal('m-task');return {date,pending:wbViewRefreshPending};});
 assert(resumed.date==='2027-01-02' && !resumed.pending,'после закрытия формы обновление применяется; новая задача использует новый день');
 const calendar=await page.evaluate(()=>{calYear=2025;calMonth=2;window.__now=new __RealDate(2027,1,1,12).getTime();wbLiveUiTick();return {year:calYear,month:calMonth};});
 assert(calendar.year===2025 && calendar.month===2,'выбранный исторический месяц календаря не сбрасывается');
 // Защита от повторной установки таймеров.
 const once=await page.evaluate(()=>{wbStartLiveUi();const first=wbDayPoll;wbStartLiveUi();return {newTimer:wbDayPoll!==first,active:!!wbDayTimer&&!!wbDayPoll};});
 assert(once.newTimer && once.active,'повторный запуск заменяет таймеры, а не накапливает их');
 // Офлайн-возврат тоже обязан обновлять дату.
 await page.context().setOffline(true);
 await page.evaluate(()=>{window.__now=new __RealDate(2027,1,2,8).getTime();window.dispatchEvent(new Event('focus'));});
 assert(await page.evaluate(()=>TODAY==='2027-02-02'),'возврат в окно обновляет дату даже без сети');
 await page.context().setOffline(false);
 // Запрос возврата и минутная страховка используют один коалесцируемый путь.
 await page.waitForTimeout(220);
 await page.evaluate(()=>{
  stopRealtime();wbLastWakeSync=0;_rtStatus='live';window.__syncs=0;window.__realSync=syncFromSupabase;
  window.syncFromSupabase=async()=>{window.__syncs++;S.tasks.push({id:900,owner_id:'u1',text:'Обновлено с сервера',date:TODAY,done:false,clientId:0});};
  window.loadDelegations=async()=>{};window.loadAllProfiles=async()=>{};window.repLoadRemote=async()=>{};
  window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));
 });
 await page.waitForTimeout(2200);
 const wake=await page.evaluate(()=>({n:window.__syncs,rendered:document.getElementById('dash-tasks').textContent.includes('Обновлено с сервера'),page:currentPageId()}));
 assert(wake.n===1 && wake.rendered && wake.page==='dashboard','возврат автоматически подтягивает данные одним запросом и обновляет текущую страницу: '+JSON.stringify(wake));
 const deferred=await page.evaluate(()=>{openAddTask();document.getElementById('t-text').value='Второй черновик';const n=window.__syncs;rtFullResync();return n;});
 await page.waitForTimeout(2150);
 assert(await page.evaluate(n=>window.__syncs===n && wbRemoteResyncNeeded && document.getElementById('t-text').value==='Второй черновик',deferred),'фоновая полная синхронизация ждёт завершения редактирования');
 await page.evaluate(()=>{closeModal('m-task');document.activeElement?.blur();wbLiveUiTick();});
 await page.waitForTimeout(2150);
 assert(await page.evaluate(n=>window.__syncs===n+1,deferred),'отложенное обновление автоматически продолжается после закрытия формы');
 // Очередь не должна быть перезаписана снимком с сервера.
 const q=await page.evaluate(()=>{loadOfflineQueue();enqueueOp({table:'tasks',op:'update',values:{text:'Локальная правка'},match:{eq:[['id',900]]}});const n=window.__syncs;rtFullResync();return n;});
 await page.waitForTimeout(2150);
 assert(await page.evaluate(n=>window.__syncs===n && offlineQueue.length===1 && wbRemoteResyncNeeded,q),'неотправленная очередь защищена от фоновой пересинхронизации');
 // Долгий запрос: повторные сигналы не создают параллельные синхронизации.
 await page.evaluate(()=>{offlineQueue=[];persistOfflineQueue();window.syncFromSupabase=()=>{window.__syncs++;return new Promise(r=>window.__finishSync=r)};rtFullResync();});
 await page.waitForTimeout(2150);
 const busy=await page.evaluate(()=>{const n=window.__syncs;rtFullResync();rtFullResync();return {n,timer:!!_rtResyncTimer,busy:!!_rtResyncRun};});
 assert(busy.busy && !busy.timer,'параллельная догоняющая синхронизация не создаётся');
 await page.evaluate(()=>{window.__afterSwitch=0;window.loadDelegations=async()=>{window.__afterSwitch++};wbResetSessionState();currentUser={id:'u2'};currentProfile={id:'u2',role:'manager'};window.__finishSync();});
 await page.waitForTimeout(100);
 const stopped=await page.evaluate(()=>({clean:!wbDayTimer&&!wbDayPoll&&!_rtResyncTimer&&!_rtResyncRun,late:window.__afterSwitch===0}));
 assert(stopped.clean && stopped.late,'выход останавливает таймеры и продолжение запоздалой синхронизации');
 const race=await page.evaluate(async()=>{
  S=wbEmptyState();S.clients=[{id:1,name:'Свой',company:'До правки',owner_id:'u2',history:[]}];
  let finish;sb.from=table=>{const q={select(){return q},is(){return q},order(){return q},like(){return q},then(resolve){if(table==='clients')finish=resolve;else resolve({data:[],error:null});}};return q;};
  const pending=window.__realSync({background:true});
  await Promise.resolve();await Promise.resolve();
  S.clients[0].company='Новая локальная правка';save();
  finish({data:[{id:1,name:'Свой',company:'Устаревший серверный снимок',owner_id:'u2'}],error:null});
  const applied=await pending;
  return {applied,company:S.clients[0]?.company,retry:wbRemoteResyncNeeded};
 });
 assert(race.applied===false && race.company==='Новая локальная правка' && race.retry,'локальное изменение во время запроса защищено от устаревшего снимка: '+JSON.stringify(race));
 assert(errors.length===0,'нет JS-ошибок: '+JSON.stringify(errors));await browser.close();process.exit(0);
})().catch(e=>{console.log('FAIL '+e.stack);process.exit(1)});

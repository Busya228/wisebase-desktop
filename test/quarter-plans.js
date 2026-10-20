// Новые функции 29.2.4. Полностью локально, сервер и CDN заблокированы _helpers.
const fs=require('fs'),path=require('path');
const {launch,openApp,assert}=require('./_helpers');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/quarter-cached-cells.json')));
const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'../../plans/Урал_IV_квартал_2026_только_планы.json')));
(async()=>{
 const {browser,page,errors}=await launch({stub:true});await openApp(page);
 const pure=await page.evaluate(({fixture,seed})=>{
  const result={}, doc=QP.parseWorkbook(fixture);result.count=doc.rows.length;result.total=doc.rows.reduce((s,r)=>s+(r.planShip||0),0);result.receipts=doc.rows.reduce((s,r)=>s+(r.planReceipts||0),0);result.blanks=doc.rows.filter(r=>r.month!==10).every(r=>r.planShip===null&&r.planReceipts===null);result.fields=Object.keys(doc.rows[0]).sort();
  const reject=fn=>{try{fn();return false;}catch(e){return true;}};
  const bad=structuredClone(fixture);bad.Sheets['Лист1'].I5={t:'e',v:'#VALUE!'};result.errorCell=reject(()=>QP.parseWorkbook(bad));
  const noCache=structuredClone(fixture);delete noCache.Sheets['Лист1'].I5.v;result.noCache=reject(()=>QP.parseWorkbook(noCache));
  const badTotal=structuredClone(fixture);badTotal.Sheets['Лист1'].B4.v=1;result.totalMismatch=reject(()=>QP.parseWorkbook(badTotal));
  result.duplicate=reject(()=>QP.validate({...seed,rows:[seed.rows[0],seed.rows[0]]}));result.badQuarter=reject(()=>QP.validate({...seed,quarter:1}));result.conditional=QP.isConditionalRows(['Деменьшин П. М.','Дронь Н. С.','Стариков А. Ю.','Турусов К. М.'].map(name=>({'РМ ФИО':name,'Направление_РМ':'Урал','Факт_отгрузки_мес., руб.':1,'Факт_заказов_мес., руб.':1,'Факт_поступлений_мес., руб.':1})));result.notByFilename=!QP.isConditionalRows([{'РМ ФИО':'Деменьшин П. М.','Факт_отгрузки_мес., руб.':100}]);result.negative=reject(()=>QP.validate({...seed,rows:[{...seed.rows[0],planShip:-1}]}));result.fictitious=reject(()=>QP.validate({...seed,rows:[{...seed.rows[0],name:'Стариков А. Ю.'}]}));
  const old=[seed.rows[0]], update=[{...seed.rows[0],planShip:null,planReceipts:0}];result.merged=QP.mergeRows(old,update)[0];result.oldUnchanged=old[0].planReceipts===36929520;
  result.rename=QP.mergeRows(old,[{...seed.rows[0],name:'Новое ФИО',planShip:null}]);
  currentUser={id:'plans-a'};currentProfile={id:'plans-a',role:'manager',full_name:'Менеджер'};
  __qp.setData({'2026-4':{...seed,revision:3}});
  const raw=[{'РМ ФИО':'Деменьшин П. М.','Направление_РМ':'Урал','План_отгрузок_мес., руб.':1,'Факт_отгрузки_мес., руб.':18720000,'Факт_поступлений_мес., руб.':18464760}];
  result.overlay=QP.overlay(2026,10,raw)[0];result.rawUnchanged=raw[0]['План_отгрузок_мес., руб.']===1;result.noGuess=QP.overlay(2026,10,[{'РМ ФИО':'Деменьшин Д. Д.','Направление_РМ':'Урал','Факт_отгрузки_мес., руб.':100}])[0].planShip===null;
  result.receiptRatio=QP.receiptSummary([{planReceipts:100,factReceipts:50},{planReceipts:300,factReceipts:300}]).pct;
  result.receiptMissing=QP.receiptSummary([{planReceipts:100,factReceipts:null}]);result.zero=QP.receiptSummary([{planReceipts:100,factReceipts:0}]).pct;
  result.fictionalRow=repApi.parseRow({'РМ ФИО':'Стариков А. Ю.','План_отгрузок_мес., руб.':72000000,'План_поступлений_мес., руб.':88560000,'Факт_отгрузки_мес., руб.':123});
  __rep.setData({'2026-10':{rows:raw,loaded:'test'}});__rep.setPeriod('quarter',2026,9);__rep.render();
  result.quarterNoPercent=[...document.querySelectorAll('#repTableBody .rep-pct')].every(e=>e.textContent==='—');result.headerCells=document.querySelectorAll('#repTableSection th').length;result.quarterReceipt=document.getElementById('qp-receipts').textContent;result.countReports=Object.keys(repApi.getData()).length;
  __rep.setData({});__rep.setPeriod('month',2026,9);__rep.render();result.planOnlyNoZero=[...document.querySelectorAll('#repKpis .rk-val')].slice(0,3).every(e=>e.textContent==='—');
  __rep.setData({'2026-10':{rows:raw,loaded:'test'}});const months=srAllMonths();result.actualMonths=months.map(r=>r.key);renderStatsReports();result.receiptStats=!!document.getElementById('qp-stats-receipts').querySelector('table');result.rankOverlay=document.getElementById('sr-rank').textContent.includes('37,4 млн');result.statsCoverage=srTotals(months[0].rows).pct===null;
  switchAnTab('quarter');result.quarterTab=document.getElementById('an-panel-quarter').style.display==='';switchAnTab('clients');result.switchBack=document.getElementById('an-panel-quarter').style.display==='none';
  return result;
 },{fixture,seed});
 assert(pure.count===9&&pure.total===72000000&&pure.receipts===88560000,'из исходной книги: только 9 месячных строк, планы 72 млн / 88,56 млн');
 assert(pure.conditional&&pure.notByFilename,'условный образец распознается по содержимому, не имени файла');
 assert(pure.blanks,'ноябрь/декабрь не превращаются в нули');
 assert(pure.fields.join(',')==='dir,month,name,planReceipts,planShip,source','факты, маржа, второй лист, итоги не попадают в планы');
 for(const k of ['errorCell','noCache','totalMismatch','duplicate','badQuarter','negative','fictitious'])assert(pure[k],'валидация: '+k);
 assert(pure.merged.planShip===37440000&&pure.merged.planReceipts===0&&pure.oldUnchanged,'повторный импорт: пустое сохраняет старое, настоящий ноль допустим, исходник не меняется');
 assert(pure.rename.length===1&&pure.rename[0].planShip===37440000,'исправление сопоставления одной исходной строки не удваивает план');
 assert(pure.overlay.planShip===37440000&&pure.overlay.factShip===18720000&&pure.overlay.planPct===0.5&&pure.overlay.factReceipts===18464760&&pure.rawUnchanged,'план применяется без изменения актуальных фактов и сохраненных reports');
 assert(pure.noGuess,'одна фамилия без подтвержденного соответствия не присваивает план однофамильцу');
 assert(pure.receiptRatio===0.875&&pure.receiptMissing.pct===null&&pure.receiptMissing.fact===null&&pure.zero===0,'поступления: отношение сумм, неизвестное не ноль, реальный ноль сохранен');
 assert(pure.fictionalRow.planShip===null&&pure.fictionalRow.planReceipts===null&&pure.fictionalRow.factShip===123,'исключены только конфликтующие планы Старикова; реальные факты не удаляются');
 assert(pure.quarterNoPercent&&pure.countReports===1,'неполный квартал не считается выполненным и не создает фиктивных reports');
 assert(pure.headerCells===7&&pure.receiptStats&&pure.quarterTab&&pure.switchBack,'точечная колонка, отдельные поступления, новая квартальная вкладка, старые вкладки работают');
 assert(pure.rankOverlay&&pure.statsCoverage,'рейтинг использует квартальные планы, неполное покрытие не выдает процент');
 assert(pure.planOnlyNoZero,'месяц только с планом не показывает нулевые фактические KPI');
 assert(JSON.stringify(pure.actualMonths)==='["2026-10"]','статистика не добавляет будущие месяцы без реальных отчетов');
 // Импорт JSON проходит через настоящие обработчики файла/предпросмотра/сохранения.
 await page.evaluate(()=>{
  __qp.setData({});__callsPlan=[];__remotePlans=[];__conflict=false;
  sb.from=table=>{const q={op:'select',filter:[]};const api={select(){return api;},eq(k,v){q.filter.push([k,v]);return api;},insert(r){q.op='insert';q.rec=r;return api;},update(r){q.op='update';q.rec=r;return api;},then(resolve){
   if(q.op!=='select'){__callsPlan.push({table,...q});if(__conflict)return resolve({data:[],error:null});const rev=q.op==='insert'?1:__remotePlans[0].revision+1;__remotePlans=[{...q.rec,revision:rev,uploaded_at:'2026-10-20T12:00:00Z'}];}
   resolve({data:structuredClone(__remotePlans),error:null});}};return api;};showPage('analytics');switchAnTab('quarter');
 });
 await page.locator('#qp-file').setInputFiles({name:'plans.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(seed))});
 await page.waitForFunction(()=>!!__qp.getPending());
 assert(await page.evaluate(()=>__callsPlan.length===0),'предпросмотр не выполняет записей');
 await page.locator('#qp-save').click();assert(await page.evaluate(()=>__callsPlan.length===0),'без подтверждения импорт не записывает данные');
 await page.locator('#qp-confirm').check();await page.locator('#qp-save').click();await page.waitForFunction(()=>!__qp.getPending());
 const saved=await page.evaluate(()=>({calls:__callsPlan,store:__qp.getData(),raw:repApi.getData()}));
 assert(saved.calls.length===1&&saved.calls[0].table==='report_plans'&&saved.calls[0].op==='insert','импорт пишет только report_plans, не reports/clients/profiles');
 assert(saved.store['2026-4'].revision===1&&Object.keys(saved.raw).length===1,'серверная версия принята, месячные отчеты сохранены');
 // Повторный импорт с оптимистической блокировкой.
 await page.locator('#qp-file').setInputFiles({name:'plans.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(seed))});await page.waitForFunction(()=>!!__qp.getPending());
 await page.evaluate(()=>{__conflict=true;});await page.locator('#qp-confirm').check();await page.locator('#qp-save').click();
 const conflict=await page.evaluate(()=>({msg:document.getElementById('qp-save-status').textContent,last:__callsPlan.at(-1),rev:__qp.getData()['2026-4'].revision}));
 assert(conflict.last.op==='update'&&conflict.last.filter.some(([k,v])=>k==='revision'&&v===1)&&conflict.rev===1&&/Не сохранено/.test(conflict.msg),'конфликт версии не выдается за успешное сохранение');
 // Смена учетной записи во время запроса — старый ответ не возвращает чужие планы.
 const isolation=await page.evaluate(async(seed)=>{
  let release;sb.from=()=>({select:()=>new Promise(res=>release=res)});const request=QP.load();currentUser={id:'plans-b'};QP.reset();release({data:[{...seed,revision:99}],error:null});await request;return Object.keys(__qp.getData()).length;
 },seed);
 assert(isolation===0,'запоздалый ответ предыдущей сессии игнорируется');
 assert(!errors.length,'нет ошибок JavaScript: '+JSON.stringify(errors));
 await browser.close();
})().catch(e=>{console.log('FAIL exception: '+e.stack);process.exit(1);});

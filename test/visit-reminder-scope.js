const {openApp,launch,assert}=require('./_helpers.js');
(async()=>{
 const {browser,page,errors}=await launch({stub:true});await openApp(page);
 await page.evaluate(()=>{
  currentUser={id:'m1'};currentProfile={id:'m1',role:'manager'};delegatedFrom=new Set(['m3']);S=wbEmptyState();
  const c=(id,name,owner,date,region='Свой регион')=>({id,name,company:name,owner_id:owner,nextVisitDate:date,region,city:'Город',status:'active',tags:[],history:[],contacts:[],geoLinks:[]});
  S.clients=[c(1,'СВОЙ СЕГОДНЯ','m1',TODAY),c(2,'ЧУЖОЙ','m2','2000-01-01','Чужой регион'),c(3,'ДЕЛЕГИРОВАННЫЙ','m3','2000-01-01','Делегированный регион'),c(4,'БЕЗ ВЛАДЕЛЬЦА',null,'2000-01-01','Без владельца'),c(5,'СВОЙ БУДУЩИЙ','m1','2099-01-01'),c(6,'СВОЙ БЕЗ ДАТЫ','m1',''),c(7,'СВОЙ ПРОСРОЧЕННЫЙ','m1','2000-01-01')];
  tripView='list';document.getElementById('trip-hide-inactive').checked=false;
  for(const x of S.clients){tripOpen.regions.add(x.region);tripOpen.cities.add(x.region+'||'+x.city);}
 });
 const personal=await page.evaluate(()=>{
  renderDueVisits();showPage('trips');
  return {ids:S.clients.filter(wbVisitReminderIsDue).map(c=>c.id),dash:document.getElementById('dash-due').textContent,rows:document.querySelectorAll('#trips-wrap .trip-row').length,due:[...document.querySelectorAll('#trips-wrap .trip-row.due .trip-name')].map(e=>e.textContent),widget:document.querySelector('.trip-due-widget')?.textContent,caption:document.getElementById('trip-due-caption').textContent,segment:CLIENT_SEGMENTS.find(s=>s.key==='due').pred(S.clients[2]),delegatedVisible:scopedClients().some(c=>c.id===3),foreignDateStillDue:tripIsDue(S.clients[1])};
 });
 assert(JSON.stringify(personal.ids)==='[1,7]','менеджеру напоминают только свои сегодняшние/просроченные визиты, не чужие/делегированные/без владельца');
 assert(personal.dash.includes('2 объекта') && !/Чужой регион|Делегированный регион|Без владельца/.test(personal.dash),'главная считает только личные визиты');
 assert(personal.rows===7 && personal.delegatedVisible && personal.foreignDateStillDue,'общая карта и доступ к делегированным карточкам сохранены, чужие даты не переписаны');
 assert(JSON.stringify(personal.due.sort())===JSON.stringify(['СВОЙ ПРОСРОЧЕННЫЙ','СВОЙ СЕГОДНЯ'].sort()),'на общей карте подсвечены только собственные визиты');
 assert(personal.widget.includes('2 объекта') && personal.caption.includes('мои') && !personal.segment,'виджет, фильтр и сегмент клиентов используют одно персональное правило');
 const cards=await page.evaluate(()=>({other:mkTripCard(S.clients[1]).includes('trip-card due'),delegate:mkTripRow(S.clients[2]).includes('trip-row due'),mine:mkTripCard(S.clients[0]).includes('trip-card due')}));
 assert(!cards.other&&!cards.delegate&&cards.mine,'правило действует в карточном и строчном видах');
 const filtered=await page.evaluate(()=>{document.getElementById('trip-due-only').checked=true;renderTrips();return [...document.querySelectorAll('#trips-wrap .trip-name')].map(e=>e.textContent).sort();});
 assert(JSON.stringify(filtered)===JSON.stringify(['СВОЙ ПРОСРОЧЕННЫЙ','СВОЙ СЕГОДНЯ'].sort()),'фильтр «пора посетить» не возвращает клиента другого менеджера');
 const emptyRegion=await page.evaluate(()=>{document.getElementById('trip-region').value='Чужой регион';renderTrips();return {rows:document.querySelectorAll('#trips-wrap .trip-row').length,text:document.getElementById('trips-wrap').textContent};});
 assert(emptyRegion.rows===0 && emptyRegion.text.includes('Нет ваших объектов') && emptyRegion.text.includes('2 объекта'),'чужой регион не добавляет чужие напоминания, общий личный счётчик не теряется');
 const noMine=await page.evaluate(()=>{document.getElementById('trip-region').value='';S.clients.filter(c=>c.owner_id==='m1').forEach(c=>c.nextVisitDate='2099-01-01');renderDueVisits();renderTrips();return {dash:document.getElementById('dash-due').textContent,widget:!!document.querySelector('.trip-due-widget'),rows:document.querySelectorAll('#trips-wrap .trip-row').length};});
 assert(!noMine.dash.trim()&&!noMine.widget&&!noMine.rows,'когда просрочены только чужие клиенты, личное напоминание не показывается');
 const ownership=await page.evaluate(()=>{
  S.clients[0].nextVisitDate=TODAY;S.clients[6].nextVisitDate='2000-01-01';
  S.clients[0].owner_id='m2';S.clients[1].owner_id='m1';rtRender('clients');renderDueVisits();
  return {ids:S.clients.filter(wbVisitReminderIsDue).map(c=>c.id),names:[...document.querySelectorAll('#trips-wrap .trip-name')].map(e=>e.textContent)};
 });
 assert(JSON.stringify(ownership.ids)==='[2,7]' && !ownership.names.includes('СВОЙ СЕГОДНЯ') && ownership.names.includes('ЧУЖОЙ'),'после переназначения владельца напоминание следует за новым ответственным');
 const roles=await page.evaluate(()=>{
  S.clients[0].owner_id='m1';S.clients[1].owner_id='m2';
  currentProfile.role='administrator';adminViewOwners=null;const admin=S.clients.filter(wbVisitReminderIsDue).length;
  adminViewOwners=new Set(['m1']);const scoped=S.clients.filter(wbVisitReminderIsDue).map(c=>c.id);
  currentProfile.role='user';const head=S.clients.filter(wbVisitReminderIsDue).length;
  currentUser={id:'m2'};currentProfile={id:'m2',role:'manager'};delegatedFrom=new Set(['m1']);const other=S.clients.filter(wbVisitReminderIsDue).map(c=>c.id);
  currentProfile.role=null;const unknown=S.clients.filter(wbVisitReminderIsDue).length;
  currentUser=null;currentProfile={role:'admin'};const signedout=S.clients.filter(wbVisitReminderIsDue).length;
  return {admin,scoped,head,other,unknown,signedout,stats:Object.values(statusBuckets()).reduce((n,a)=>n+a.length,0)};
 });
 assert(roles.admin===5 && JSON.stringify(roles.scoped)==='[1,7]' && roles.head===5,'администратор сохраняет общий обзор/личный фильтр, руководитель подразделения — общий');
 assert(JSON.stringify(roles.other)==='[2]' && roles.unknown===0 && roles.signedout===0,'смена аккаунта/отсутствующая роль не возвращают чужие напоминания');
 assert(roles.stats===7,'общая статистика по всей базе не урезана');
 assert(errors.length===0,'нет JS-ошибок: '+JSON.stringify(errors));await browser.close();process.exit(0);
})().catch(e=>{console.log('FAIL '+e.stack);process.exit(1)});

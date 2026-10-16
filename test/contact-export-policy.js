const {openApp,launch,assert}=require('./_helpers.js');
(async()=>{
 const {browser,page,errors}=await launch({stub:true});await openApp(page);
 const out=await page.evaluate(()=>{
  currentUser={id:'u1'};currentProfile={id:'u1',role:'manager'};delegatedFrom=new Set(['u2']);
  S.clients=[{id:1,name:'Свой',company:'Своя',owner_id:'u1',tags:[],history:[],contacts:[{name:'Первый',phone:'1'},{name:'Второй',phone:'2'}]},{id:2,name:'Коллега',company:'Чужая',owner_id:'u2',tags:[],history:[]},{id:3,name:'Ничей',owner_id:null,tags:[],history:[]}];
  S.tasks=[{id:1,text:'Своя',clientId:1,owner_id:'u1'},{id:2,text:'Чужая',clientId:2,owner_id:'u2'}];S.offers=[{id:1,text:'Чужое',clientId:2,owner_id:'u2'}];
  XLSX.utils.book_append_sheet=(wb,ws,n)=>{wb.Sheets[n]=ws;wb.SheetNames.push(n)};XLSX.writeFile=wb=>{window.__wb=wb};
  const ids=wbExportClients().map(c=>c.id),raw=buildExportWorkbook();
  exportClientsTemplate();const template=window.__wb.Sheets['Клиенты'].__d;
  selC=new Set([1,2,3]);exportSelectedClients();const selected=window.__wb.Sheets['Клиенты'].__d;
  runAutoSaveBackup();const auto=window.__wb.Sheets['Клиенты'].__d;
  const stats=Object.values(statusBuckets()).reduce((n,list)=>n+list.length,0);
  renderAnKpis();const statsText=document.getElementById("an-kpis").textContent;
  currentProfile.role='administrator';const admin=wbExportClients().length;
  currentProfile.role='user';const head=wbExportClients().length;
  return {ids,rawClients:raw.Sheets['Клиенты'].__d,rawTasks:raw.Sheets['Задачи'].__d,rawOffers:raw.Sheets['Предложения'].__d,template,selected,auto,stats,statsText,admin,head};
 });
 assert(JSON.stringify(out.ids)==='[1]','менеджер выгружает только своих, не делегированных и не ничейных');
 assert(out.rawClients.length===2 && out.rawClients[1][1]==='Свой','полный экспорт клиентов ограничен владельцем');
 assert(out.rawTasks.length===2 && out.rawOffers.length===1,'смежные листы не возвращают чужих клиентов');
 assert(out.template.length===3 && out.template[2][1]==='Второй','шаблон сохраняет дополнительные контакты');
 assert(out.selected.length===2 && out.auto.length===2,'выбранные клиенты и автобэкап соблюдают правило');
 assert(out.stats===3 && out.statsText.includes('Всего клиентов'),'общие данные и статистика не обрезаны экспортным фильтром');
 assert(out.admin===3 && out.head===3,'администратор и руководитель подразделения сохраняют прежний экспорт');
 assert(errors.length===0,'нет JS-ошибок: '+JSON.stringify(errors));await browser.close();process.exit(0);
})().catch(e=>{console.log('FAIL '+e.stack);process.exit(1)});

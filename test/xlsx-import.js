// Regression: template/legacy Excel must write to the server, with uploader as owner.
const {openApp,launch,assert}=require('./_helpers.js');
(async()=>{
 const {browser,page,errors}=await launch({stub:true});await openApp(page);
 await page.evaluate(()=>{
  currentUser={id:'u1'};currentProfile={id:'u1',role:'manager'};S.clients=[];
  window.__inserts=[];window.__next=100;window.__error=null;
  sb.from=table=>{let values;const q={insert(v){values=v;return q},select(){return q},single:async()=>{window.__inserts.push({table,values});if(window.__error)return {error:window.__error};return {data:{id:window.__next++,...values},error:null}}};return q};
 });
 const r1=await page.evaluate(async()=>{
  const rows=[['ООО Ромашка','Иван Петров','Директор','+7 900 111-22-33','ivan@romashka.ru','7707083893','Свердловская область','Екатеринбург','ул. Ленина 1',500000,'Действующий','X','','','X','','','X','','','','2026-10-01','Заметка']];
  const result=await importClientsTemplateRows(rows);return {result,c:S.clients[0],write:window.__inserts[0]};
 });
 assert(r1.result.saved===1 && r1.write.table==='clients','импорт подтверждён сервером, а не только local save');
 assert(r1.c.id===100 && r1.c.owner_id==='u1' && r1.write.values.owner_id==='u1','серверный ID и ответственный — загрузивший менеджер');
 assert(r1.c.company==='ООО Ромашка' && r1.c.name==='Иван Петров' && r1.c.inn==='7707083893','основные поля сохранены');
 assert(r1.c.status==='active' && r1.c.potential===500000,'статус и сумма сохранены');
 assert(JSON.stringify(r1.c.channels)==='["ФМА"]' && JSON.stringify(r1.c.formats)==='["Салон"]','каналы/форматы сохранены');
 const r2=await page.evaluate(async()=>{
  const r=await importClientsTemplateRows([['ООО Вторая','Пётр Сидоров','Закупщик','9001234567'],['','Мария Иванова','Бухгалтер','9007654321']]);return {r,c:S.clients.at(-1)};
 });
 assert(r2.r.saved===1 && r2.c.contacts.length===2 && r2.c.contacts[1].name==='Мария Иванова','две строки контактов объединены в одного клиента');
 const r3=await page.evaluate(async()=>{const n=S.clients.length,r=await importClientsTemplateRows([['ООО Ромашка','Иван Петров']]);return {r,n,after:S.clients.length}});
 assert(r3.r.skipped===1 && r3.n===r3.after,'собственный повторный импорт пропускает дубликат');
 const r4=await page.evaluate(async()=>{const r=await importClientsTemplateRows([Array(23).fill('')]);return r});
 assert(r4.saved===0,'пустая строка пропущена');
 const r5=await page.evaluate(async()=>{S.clients.push({id:500,company:'Чужая','name':'Чужой',owner_id:'u2',history:[]});const r=await importClientsTemplateRows([['Чужая','Контакт']]);return {r,clients:S.clients.filter(c=>c.company==='Чужая').map(c=>({owner:c.owner_id,id:c.id}))}});
 assert(r5.r.saved===1 && r5.clients.some(c=>c.owner==='u2'&&c.id===500) && r5.clients.some(c=>c.owner==='u1'),'чужая карточка не переназначена: создан собственный клиент');
 const r6=await page.evaluate(async()=>{const n=S.clients.length;window.__error={message:'permission denied'};const r=await importClientsTemplateRows([['Отказ','Контакт']]);window.__error=null;return {r,before:n,after:S.clients.length}});
 assert(r6.r.stopped && r6.r.saved===0 && r6.before===r6.after,'отказ сервера не превращается в ложный успешный локальный импорт');
 const r7=await page.evaluate(async()=>{
  XLSX.utils.sheet_to_json=ws=>ws.__rows;
  const wb={SheetNames:['Клиенты','Задачи'],Sheets:{'Клиенты':{__rows:[['ID','Имя'],[42,'Старый контакт','Архивная компания','79000000000','old@example.com',10,'vip','note','Другой контакт|Директор|79000000001|second@example.com','ФМА','Салон','owner_from_file']]},'Задачи':{__rows:[['ID'],[2,'Звонок','Высокий','Архивная задача','Другой контакт','20.10.2026','10:00','Нет','','Заметка']]}}};
  const r=await wbImportWorkbook(wb);return {r,writes:window.__inserts.slice(-2),client:S.clients.find(c=>c.company==='Архивная компания'),task:S.tasks.at(-1)};
 });
 assert(r7.r.saved===1 && r7.r.tasksSaved===1 && r7.client.owner_id==='u1' && r7.task.owner_id==='u1','старый формат клиентов и задач сохраняется в CRM от имени загрузившего');
 assert(r7.task.clientId===r7.client.id,'задача связана с новым серверным ID клиента, не ID из Excel');
 assert(!r7.writes.some(w=>w.values.owner_id==='owner_from_file'),'ответственный из файла игнорируется');
 const guards=await page.evaluate(async()=>{
  const out={};const initial=window.__inserts.length;const oldOnline=isOnline;isOnline=()=>false;
  try{await importClientsTemplateRows([['Офлайн','Контакт']]);out.offline=false}catch(_){out.offline=window.__inserts.length===initial}finally{isOnline=oldOnline}
  try{wbParseClientRows(Array.from({length:5001},()=>['Лимит']),true);out.limit=false}catch(_){out.limit=true}
  try{wbImportDate('31.02.2026');out.date=false}catch(_){out.date=true}
  let finish;const oldFrom=sb.from;
  sb.from=()=>{const q={insert(){return q},select(){return q},single(){return new Promise(r=>{finish=r})}};return q};
  const pending=importClientsTemplateRows([['Смена сессии','Контакт']]);
  wbResetSessionState();currentUser={id:'u2'};currentProfile={id:'u2',role:'manager'};
  finish({data:{id:900,company:'Смена сессии',name:'Контакт',owner_id:'u1'},error:null});
  const r=await pending;out.session=r.stopped && r.saved===0 && S.clients.length===0;
  sb.from=oldFrom;return out;
 });
 for(const [k,v] of Object.entries(guards))assert(v,'ограничение импорта '+k+': '+v);
 const r8=await page.evaluate(async()=>{currentUser=null;try{await importClientsTemplateRows([['Без входа','Контакт']]);return false}catch(_){return true}});
 assert(r8,'без аккаунта импорт запрещён');
 assert(errors.length===0,'нет JS-ошибок: '+JSON.stringify(errors));await browser.close();process.exit(0);
})().catch(e=>{console.log('FAIL '+e.stack);process.exit(1)});

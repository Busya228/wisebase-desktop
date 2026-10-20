// Synthetic fixture: duplicated columns and values, no customer files committed.
const {launch,openApp,assert}=require('./_helpers');
(async()=>{const {browser,page,errors}=await launch({stub:true});await openApp(page);
 const result=await page.evaluate(()=>{
  const headers=['Направление','Направление_РМ','РМ ФИО','Факт_отгрузки_мес., руб.','Факт_заказов_мес., руб.','Факт С2, %'];
  const grid=[headers.concat(headers,['Факт_поступлений_мес., руб.']),['Региональный','Урал','Тестовый А. А.',1,1,.01,'Региональный','Урал','Тестовый А. А.','20\u00a0664\u00a0147','23\u00a0343\u00a0934',.6123,'19\u00a0851\u00a0979']];
  XLSX.utils.sheet_to_json=()=>structuredClone(grid);XLSX.utils.encode_col=c=>String.fromCharCode(65+c);XLSX.utils.encode_cell=({r,c})=>String.fromCharCode(65+c)+(r+1);
  const wb={SheetNames:['Лист1'],Sheets:{Лист1:{}}};let blocks=__repImport.candidates(wb);const out={count:blocks.length,first:repApi.parseRow(blocks[0].rows[0]),second:repApi.parseRow(blocks[1].rows[0]),rightColumns:Object.keys(blocks[1].rows[0])};
  grid[1][9]=0;out.realZero=repApi.parseRow(__repImport.candidates(wb)[1].rows[0]).factShip===0;
  grid[1][9]='(Пусто)';out.blank=repApi.parseRow(__repImport.candidates(wb)[1].rows[0]).factShip===null;
  grid[0][8]='  РМ\u00a0ФИО  ';out.whitespace=__repImport.candidates(wb).length===2;
  grid[1][9]='100oops';try{__repImport.candidates(wb);out.bad=false;}catch(e){out.bad=true;}
  grid[1][9]=100;wb.Sheets.Лист1.J2={t:'e',v:7};try{__repImport.candidates(wb);out.errorCell=false;}catch(e){out.errorCell=true;}
  wb.Sheets.Лист1.J2={t:'n',f:'SUM(A1:A5)'};try{__repImport.candidates(wb);out.noCache=false;}catch(e){out.noCache=true;}
  out.strict=__rep.cleanNum('123abc')===null&&__rep.cleanNum('#DIV/0!')===null&&__rep.cleanNum('1\u202f234,50 ₽')===1234.5;
  return out;
 });
 assert(result.count===2,'два блока с одинаковыми заголовками распознаются отдельно');
 assert(result.first.factShip===1&&result.second.factShip===20664147&&result.second.factOrders===23343934&&result.second.factReceipts===19851979&&result.second.c2fact===.6123,'выбранный блок сохраняет точные значения, не смешивает столбцы');
 for(const k of ['realZero','blank','whitespace','bad','errorCell','noCache','strict'])assert(result[k],'контроль импорта: '+k);
 // Exercise actual upload routing and cancellation with synthetic workbook adapter.
 const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
 await page.evaluate(()=>{
  currentUser={id:'formats-local'};currentProfile={id:'formats-local',role:'manager'};
  __rep.setData({});__rep.setPeriod('month',2026,9);window.__writes=[];
  sb.from=table=>{const a={select(){return a;},upsert(r){__writes.push({table,r});return a;},then(resolve){resolve({data:[],error:null});}};return a;};
  const ws={};XLSX.read=()=>({SheetNames:['Лист1'],Sheets:{Лист1:ws}});
  const head=['РМ ФИО','Факт_отгрузки_мес., руб.'];XLSX.utils.sheet_to_json=()=>[head.concat(head),['Тест А.',1,'Тест А.',500]];
 });
 await page.locator('#repFileInput').setInputFiles({name:'2.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('test')});await page.waitForSelector('#rep-block-choice');
 assert(await page.evaluate(()=>__writes.length===0),'до выбора блока запись не выполняется');await page.locator('[data-report-block="1"]').click();await page.waitForFunction(()=>__writes.length===1);
 assert(await page.evaluate(()=>__writes[0].r.rows[0]['Факт_отгрузки_мес., руб.']===500),'настоящий обработчик сохраняет только выбранный блок');
 await page.locator('#repFileInput').setInputFiles({name:'2.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('test')});await page.waitForSelector('#rep-block-choice');await page.locator('#rep-block-choice button').last().click();assert(await page.evaluate(()=>__writes.length===1),'отмена выбора не меняет отчеты');
 await page.evaluate(()=>{XLSX.read=()=>({SheetNames:['Лист1'],Sheets:{Лист1:{A1:{v:'ПЛАН на Октябрь 2026 Total'}}}});window.__routed=false;QP.prepareWorkbook=async()=>{__routed=true;};});
 await page.locator('#repFileInput').setInputFiles({name:'quarter.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('test')});await page.waitForFunction(()=>__routed);
 assert(await page.evaluate(()=>__writes.length===1),'квартальная книга с обычной кнопки направляется к планам без записи в reports');
 assert(!errors.length,'нет ошибок JavaScript: '+JSON.stringify(errors));await browser.close();
})().catch(e=>{console.log('FAIL exception: '+e.stack);process.exit(1)});

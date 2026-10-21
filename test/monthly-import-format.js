// Regression for the exporter layout, using synthetic numbers only.
const {launch,openApp}=require('./_helpers');
const assert=require('node:assert/strict');
let browser;
(async()=>{
 const launched=await launch({stub:true});browser=launched.browser;
 const {page,errors}=launched;await openApp(page);
 const headers=['Направление','Направление_РМ','РМ ФИО','План_отгрузок_мес., руб.','Факт_отгрузки_мес., руб.','Выполнение плана, отгр.','Факт отгрузки(прош. год)','Прирост гг (отгрузки)','Прогноз_отгрузок_РП., руб.','Выполнение плана,отгр.РП','Факт_заказов_мес., руб.','НЕОТГРУЖЕННЫЕ прошлых периодов','НЕОТГРУЖЕННЫЕ текущего месяца','НЕОТГРУЖЕННЫЕ будущих периодов','Прогноз на конец мес, р','Выполнение плана,итог мес','План С2 %','Факт С2, %','С2, % Прогноз на 1 мес. вперед','План_Сквозная маржа_мес.,руб.','Факт_Сквоз.маржа (мес.), руб.','Выполнение плана, Скв. маржа','План_поступлений_мес., руб.','Факт_поступлений_мес., руб.','Выполнение плана, поступл','Прогноз_поступлений_мес., руб.','Выполнение плана, Прогноз поступ','Факт С3, %','Факт_С3 (мес.), руб.'];
 const result=await page.evaluate(headers=>{
  const a=headers.map((h,i)=>i<3?['Региональный','Урал','Тест А. А.'][i]:1);
  const b=headers.map((h,i)=>i<3?['Региональный','Урал','Тест А. А.'][i]:null);
  b[4]='1\u00a0234\u202f567';b[10]='2 345 678';b[17]=.6123;b[23]='987 654';
  const grid=[headers.slice(0,20).concat(headers),a.slice(0,20).concat(b)];
  window.__testGrid=grid;
  XLSX.utils.sheet_to_json=()=>structuredClone(__testGrid);
  XLSX.utils.encode_col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s};
  XLSX.utils.encode_cell=({r,c})=>XLSX.utils.encode_col(c)+(r+1);
  window.__testWb={SheetNames:['Лист1'],Sheets:{Лист1:{}}};
  const candidates=__repImport.candidates(__testWb),selected=__repImport.knownExport(candidates);
  const out={count:candidates.length,right:selected.left===20,keys:Object.keys(selected.rows[0]).length,parsed:repApi.parseRow(selected.rows[0]),receipt:selected.rows[0]['Факт_поступлений_мес., руб.']};
  grid[1][24]=0;out.zero=repApi.parseRow(__repImport.knownExport(__repImport.candidates(__testWb)).rows[0]).factShip===0;
  grid[1][24]='(Пусто)';out.blank=repApi.parseRow(__repImport.knownExport(__repImport.candidates(__testWb)).rows[0]).factShip===null;
  grid[1][24]='123oops';try{__repImport.candidates(__testWb);out.invalid=false}catch(e){out.invalid=true}
  grid[1][24]=1234567;
  __testWb.Sheets.Лист1.Y2={t:'e',v:7};try{__repImport.candidates(__testWb);out.error=false}catch(e){out.error=true}
  __testWb.Sheets.Лист1.Y2={t:'n',f:'SUM(A1:A5)'};try{__repImport.candidates(__testWb);out.formula=false}catch(e){out.formula=true}
  delete __testWb.Sheets.Лист1.Y2;
  // The full block is selected even when its amounts equal the left block.
  grid[1][24]=1;out.notLargest=__repImport.knownExport(__repImport.candidates(__testWb)).left===20;
  grid[1][24]=1234567;
  return out;
 },headers);
 assert.equal(result.count,2);assert.equal(result.right,true);assert.equal(result.keys,29);
 assert.equal(result.parsed.factShip,1234567);assert.equal(result.parsed.factOrders,2345678);assert.equal(result.parsed.c2fact,.6123);assert.equal(result.receipt,'987 654');
 for(const key of ['zero','blank','invalid','error','formula','notLargest'])assert.equal(result[key],true,key);
 console.log('ok known exporter: full right block selected by schema, all 29 fields retained, numeric/null/error checks');
 const dialogs=[];let accept=true;page.on('dialog',async d=>{dialogs.push(d.message());if(d.type()==='confirm'&&!accept)await d.dismiss();else await d.accept()});
 await page.evaluate(()=>{
  currentUser={id:'import-test'};currentProfile={id:'import-test',role:'manager'};
  __rep.setData({});__rep.setPeriod('month',2026,9);window.__writes=[];
  sb.from=table=>{const q={};const a={upsert(rec){q.rec=rec;return a},then(resolve){if(q.rec)__writes.push({table,rec:q.rec});resolve({data:[],error:window.__failSave?{message:'permission denied'}:null})}};return a};
  XLSX.read=()=>__testWb;
 });
 const upload=()=>page.locator('#repFileInput').setInputFiles({name:'export-any-name.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic')});
 await upload();await page.waitForFunction(()=>__writes.length===1);
 assert.equal(await page.locator('#rep-block-choice').count(),0,'known export needs no manual column editing or block selection');
 assert.equal(await page.evaluate(()=>__writes[0].rec.rows[0]['Факт_отгрузки_мес., руб.']),1234567);
 assert(dialogs.some(s=>s.replace(/\s/g,'').includes('1 234 567'.replace(/\s/g,''))));
 // Cancellation preserves saved month.
 const saved=await page.evaluate(()=>JSON.stringify(__rep.getData()));accept=false;await upload();await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>__writes.length),1);assert.equal(await page.evaluate(()=>JSON.stringify(__rep.getData())),saved);accept=true;
 // Backend failure cannot replace the saved month locally.
 await page.evaluate(()=>{__failSave=true;__testGrid[1][24]=999});await upload();await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>JSON.stringify(__rep.getData())),saved);await page.evaluate(()=>__failSave=false);
 // Unknown repeated layout requires an explicit choice; cancellation never writes.
 await page.evaluate(()=>{const h=['РМ ФИО','Факт_отгрузки_мес., руб.'];__testGrid=[h.concat(h),['Тест А.',1,'Тест А.',500]]});
 const before=await page.evaluate(()=>__writes.length);await upload();await page.waitForSelector('#rep-block-choice');
 assert.equal(await page.evaluate(()=>__writes.length),before);await page.locator('#rep-block-choice button').last().click();
 assert.equal(await page.evaluate(()=>__writes.length),before);
 console.log('ok actual upload handler: automatic known form, confirmation/cancel, server error, unknown layout guarded');
 assert.deepEqual(errors,[]);await browser.close();
})().catch(async e=>{console.error('FAIL '+e.stack);if(browser)await browser.close().catch(()=>{});process.exitCode=1});

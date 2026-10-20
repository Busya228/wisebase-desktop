const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {expected,verifyLocal,verifyRemote}=require('../scripts/verify-release-files');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wisebase-release-'));const version='29.2.6';
const hash=p=>crypto.createHash('sha512').update(fs.readFileSync(p)).digest('base64');
function manifest(name,files){fs.writeFileSync(path.join(tmp,name),'version: '+version+'\nfiles:\n'+files.map(f=>'  - url: '+f+'\n    sha512: '+hash(path.join(tmp,f))+'\n    size: '+fs.statSync(path.join(tmp,f)).size+'\n').join('')+'path: '+files[0]+'\nsha512: '+hash(path.join(tmp,files[0]))+'\nreleaseDate: "2026-10-20T12:00:00Z"\n');}
function restore(){for(const f of expected(version)){if(!f.endsWith('.yml'))fs.writeFileSync(path.join(tmp,f),(f.endsWith('.exe')?'MZ':f.endsWith('.zip')?'PK':'blockmap')+'test-only '+f);}
 manifest('latest.yml',[`WiseBase-CRM-Setup-${version}.exe`]);manifest('latest-mac.yml',['x64','arm64'].map(a=>`WiseBase-CRM-${version}-mac-${a}.zip`));}
let cases=0;const ok=(fn,label)=>{fn();cases++;console.log('ok '+label);};
try{
 restore();ok(()=>assert.equal(verifyLocal(tmp,version).files.length,9),'complete set: 9 files, both platforms, SHA512');
 ok(()=>assert.equal(verifyLocal(tmp,version,'win').files.length,4),'Windows subset includes latest.yml and NSIS');
 ok(()=>assert.equal(verifyLocal(tmp,version,'mac').files.length,5),'macOS subset includes both architectures');
 for(const f of expected(version)){restore();fs.unlinkSync(path.join(tmp,f));ok(()=>assert.throws(()=>verifyLocal(tmp,version),/missing/),'missing '+f+' blocks publishing');}
 restore();fs.appendFileSync(path.join(tmp,`WiseBase-CRM-Setup-${version}.exe`),'changed');ok(()=>assert.throws(()=>verifyLocal(tmp,version),/mismatch/),'corrupt installer rejected');
 restore();fs.writeFileSync(path.join(tmp,'latest.yml'),fs.readFileSync(path.join(tmp,'latest.yml'),'utf8').replace('version: '+version,'version: 29.2.5'));ok(()=>assert.throws(()=>verifyLocal(tmp,version),/version mismatch/),'stale metadata rejected');
 restore();manifest('latest-mac.yml',[`WiseBase-CRM-${version}-mac-x64.zip`]);ok(()=>assert.throws(()=>verifyLocal(tmp,version),/does not reference/),'missing ARM reference rejected');
 restore();fs.writeFileSync(path.join(tmp,'latest.yml'),fs.readFileSync(path.join(tmp,'latest.yml'),'utf8').replace('url: WiseBase','url: ../WiseBase'));ok(()=>assert.throws(()=>verifyLocal(tmp,version),/Unexpected/),'unsafe metadata path rejected');
 restore();const inventory=verifyLocal(tmp,version);const remote={tag_name:'v'+version,draft:true,prerelease:false,assets:inventory.files.map(f=>({...f,state:'uploaded',digest:'sha256:'+f.sha256}))};
 ok(()=>assert.equal(verifyRemote(remote,inventory),true),'remote uploaded sizes and hashes verified');
 ok(()=>assert.throws(()=>verifyRemote({...remote,assets:remote.assets.filter(a=>a.name.endsWith('x64.zip.blockmap'))},inventory),/missing/),'observed failure: only one blockmap cannot be published');
 ok(()=>assert.throws(()=>verifyRemote({...remote,draft:false},inventory),/draft/),'release must remain draft through verification');
 ok(()=>assert.throws(()=>verifyRemote({...remote,assets:remote.assets.map((a,i)=>i? a:{...a,size:1})},inventory),/incomplete/),'remote wrong size rejected');
 ok(()=>assert.throws(()=>verifyRemote({...remote,assets:remote.assets.map((a,i)=>i? a:{...a,state:'new'})},inventory),/incomplete/),'unfinished upload rejected');
 ok(()=>assert.throws(()=>verifyRemote({...remote,assets:remote.assets.map((a,i)=>i? a:{...a,digest:'sha256:wrong'})},inventory),/checksum/),'remote corrupt upload rejected');
 const wf=fs.readFileSync(path.join(__dirname,'../.github/workflows/release.yml'),'utf8');
 ok(()=>{assert(wf.includes('--publish never'));assert(!wf.includes('--publish always'));assert(wf.includes('actions/download-artifact@v4'));assert(wf.indexOf('verify-release-files.js --remote')<wf.indexOf('--draft=false --latest'));},'single publisher, artifact transfer, check before public visibility');
 console.log(`PASS ${cases} release completeness checks`);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

// Release completeness gate. Built-ins only; runs before and after GitHub uploads.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function check(ok,message){if(!ok)throw Error(message);}
function scalar(s){s=s.trim();if(s.startsWith('"'))return JSON.parse(s);if(s.startsWith("'")&&s.endsWith("'"))return s.slice(1,-1).replace(/''/g,"'");return s;}
function metadata(text){
 const out={files:[]};let inFiles=false,current=null;
 for(const line of text.split(/\r?\n/)){
  let m=/^(version|path|sha512):\s*(.*?)\s*$/.exec(line);if(m){out[m[1]]=scalar(m[2]);inFiles=false;continue;}
  if(/^files:\s*$/.test(line)){inFiles=true;continue;}
  if(inFiles){m=/^\s+-\s+url:\s*(.*?)\s*$/.exec(line);if(m){current={url:scalar(m[1])};out.files.push(current);continue;}
   m=/^\s+(sha512|size):\s*(.*?)\s*$/.exec(line);if(m&&current){current[m[1]]=m[1]==='size'?Number(m[2]):scalar(m[2]);continue;}
   if(/^\S/.test(line))inFiles=false;
  }
 }
 check(out.files.length>0,'Update metadata has no files');return out;
}
function expected(version,platform='all'){
 check(/^\d+\.\d+\.\d+$/.test(version),'Invalid release version');
 check(['win','mac','all'].includes(platform),'Invalid platform');
 const win=[`WiseBase-CRM-Setup-${version}.exe`,`WiseBase-CRM-Setup-${version}.exe.blockmap`,`WiseBase-CRM-Portable-${version}.exe`,'latest.yml'];
 const mac=['x64','arm64'].flatMap(arch=>[`WiseBase-CRM-${version}-mac-${arch}.zip`,`WiseBase-CRM-${version}-mac-${arch}.zip.blockmap`]).concat('latest-mac.yml');
 return platform==='all'?win.concat(mac):platform==='win'?win:mac;
}
function verifyLocal(dir,version,platform='all'){
 const names=expected(version,platform);const inventory={version,platform,files:[]};const hashes=new Map();
 for(const name of names){const p=path.join(dir,name);check(fs.existsSync(p)&&fs.statSync(p).isFile(),'Required release file missing: '+name);const data=fs.readFileSync(p);check(data.length>0,'Empty release file: '+name);
  if(name.endsWith('.exe'))check(data.subarray(0,2).toString()==='MZ','Invalid EXE: '+name);
  if(name.endsWith('.zip'))check(data.subarray(0,2).toString()==='PK','Invalid ZIP: '+name);
  const sha512=crypto.createHash('sha512').update(data).digest('base64');hashes.set(name,{sha512,size:data.length});inventory.files.push({name,size:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});
 }
 for(const name of names.filter(n=>n.endsWith('.yml'))){const meta=metadata(fs.readFileSync(path.join(dir,name),'utf8'));check(String(meta.version)===version,'Metadata version mismatch: '+name);
  const payloads=name==='latest.yml'?[`WiseBase-CRM-Setup-${version}.exe`]:['x64','arm64'].map(a=>`WiseBase-CRM-${version}-mac-${a}.zip`);
  const seen=new Set();for(const file of meta.files){const target=decodeURIComponent(file.url);check(target===path.basename(target)&&payloads.includes(target),'Unexpected updater payload: '+file.url);check(!seen.has(target),'Duplicate updater payload: '+target);seen.add(target);
   const actual=hashes.get(target);check(actual&&file.size===actual.size,'Updater size mismatch: '+target);check(file.sha512===actual.sha512,'Updater sha512 mismatch: '+target);
  }
  for(const payload of payloads)check(seen.has(payload),'Updater metadata does not reference '+payload);
  if(meta.path!==undefined){const target=decodeURIComponent(meta.path);check(seen.has(target),'Legacy updater path mismatch: '+name);check(meta.sha512===hashes.get(target).sha512,'Legacy updater sha512 mismatch: '+name);}
 }
 return inventory;
}
function verifyRemote(release,inventory){
 check(inventory.platform==='all','Remote check requires both platforms');check(release.tag_name==='v'+inventory.version,'Wrong remote tag');check(release.draft===true,'Release must remain draft until verification');check(!release.prerelease,'Stable release must not be prerelease');
 for(const file of inventory.files){const hits=(release.assets||[]).filter(a=>a.name===file.name);check(hits.length===1,'Remote asset missing or duplicate: '+file.name);const a=hits[0];check(a.state==='uploaded'&&a.size===file.size,'Remote upload incomplete: '+file.name);
  if(a.digest)check(a.digest==='sha256:'+file.sha256,'Remote checksum mismatch: '+file.name);
 }
 return true;
}
module.exports={metadata,expected,verifyLocal,verifyRemote};
if(require.main===module){try{
 if(process.argv[2]==='--remote'){verifyRemote(JSON.parse(fs.readFileSync(process.argv[3])),JSON.parse(fs.readFileSync(process.argv[4])));console.log('Remote release verified; safe to publish');}
 else {const [dir,version,platform='all',output]=process.argv.slice(2);const inventory=verifyLocal(dir,version,platform);if(output)fs.writeFileSync(output,JSON.stringify(inventory,null,2)+'\n');console.log('Verified '+inventory.files.length+' release files for '+platform+' '+version);}
 }catch(e){console.error('RELEASE BLOCKED: '+e.message);process.exit(1);}}

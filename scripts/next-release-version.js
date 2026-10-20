// Pure semver selection: never publish an updater version below an existing one.
const fs=require('fs');
function nextReleaseVersion(base,releases){
 const parse=s=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(s)?.slice(1).map(Number);
 const compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
 const wanted=parse(base);if(!wanted)throw Error('Invalid package version');
 const used=releases.map(r=>parse(r.tagName||'')).filter(Boolean).sort(compare);
 const latest=used.at(-1);if(!latest||compare(wanted,latest)>0)return wanted.join('.');
 return [latest[0],latest[1],latest[2]+1].join('.');
}
module.exports={nextReleaseVersion};
if(require.main===module){const releases=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(nextReleaseVersion(require('../package.json').version,releases));}

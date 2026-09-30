// Run with Node >= 22. Uses isolated vaults/profiles; never edits the user's vault.
// Usage: node obsidian-plugin/bench/compare.mjs FIXTURE_DIR LEGACY_ZIP OUTPUT_JSON [ROUNDS]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
const [fixture, legacyZip, output, roundsArg='2'] = process.argv.slice(2);
if (!output) throw Error('Required: fixture directory, legacy ZIP, output JSON');
const rounds = Number(roundsArg), port = 9238, appBinary='/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const all = { environment: { platform:process.platform, totalRAM:os.totalmem(), screen:[1200,900], backgroundThrottling:false, metric:'process RSS in MiB, shared pages may be counted twice; not Activity Monitor physical footprint', scrolling:'36 viewport-sized steps down/up per cycle, 3 cycles per phase', fixture:path.resolve(fixture) }, runs:[] };
const root = await fs.mkdtemp(path.join(os.tmpdir(),'zrb-native-comparison-'));
let active;
async function connect() {
  for (let i=0;i<100;i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find(t=>t.type==='page' && t.url==='app://obsidian.md/index.html');
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
        let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);p?.(m)}};
        return { close:()=>ws.close(), send:(method,params={})=>new Promise((r,j)=>{const seq=++id;const timer=setTimeout(()=>{pending.delete(seq);j(Error('CDP timeout: '+method))},30000);pending.set(seq,m=>{clearTimeout(timer);r(m)});ws.send(JSON.stringify({id:seq,method,params})) }) };
      }
    } catch {}
    await sleep(100);
  } throw Error('Obsidian CDP did not start');
}
function rss(profile) {
  const rows=execFileSync('ps',['-axo','pid=,rss=,command='],{encoding:'utf8'}).split('\n').filter(l=>l.includes(path.basename(profile)) && l.includes('/Applications/Obsidian.app/'));
  const result={main:0,renderer:0,gpu:0,other:0,total:0,pids:[]};
  for(const row of rows){const [,pid,kib,command]=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);const mb=Number(kib)/1024;const kind=command.includes('--type=renderer')?'renderer':command.includes('--type=gpu-process')?'gpu':command.includes('--type=')?'other':'main';result[kind]+=mb;result.total+=mb;result.pids.push(Number(pid))}return result;
}
async function sample(profile, evaluate, phase) {
  const samples=[];for(let i=0;i<3;i++){samples.push(rss(profile));await sleep(200)}
  const median=key=>samples.map(x=>x[key]).sort((a,b)=>a-b)[1];
  const dom=await evaluate(`JSON.stringify({nodes:document.querySelectorAll('*').length,images:document.querySelectorAll('img').length,canvases:document.querySelectorAll('canvas').length,heap:performance.memory?.usedJSHeapSize||null,visibility:document.visibilityState})`);
  return {phase,...Object.fromEntries(['main','renderer','gpu','other','total'].map(k=>[k,median(k)])),...JSON.parse(dom)};
}
try {
 for (let round=1;round<=rounds;round++) for (const kind of (round%2?['js','native']:['native','js'])) {
  const name=`${kind}-${round}`, dir=path.join(root,name), profile=path.join(dir,'profile'), vault=path.join(dir,'vault'), config=path.join(vault,'.obsidian');
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(path.join(config,'plugins'),{recursive:true});await fs.mkdir(path.join(vault,'Papers'),{recursive:true});
  for(const entry of await fs.readdir(fixture,{withFileTypes:true})) {
    if(entry.name.endsWith('.pdf'))continue;
    await fs.cp(path.join(fixture,entry.name),path.join(vault,'Papers',entry.name),{recursive:true});
  }
  const names=await fs.readdir(path.join(vault,'Papers')), bundleName=names.find(n=>n.endsWith('.zrb.json'));
  const bundle=JSON.parse(await fs.readFile(path.join(vault,'Papers',bundleName),'utf8'));
  const oldPrefix=path.basename(fixture)+'/';
  for(const b of bundle.blocks)for(const c of b.crops||[])if(c.image)c.image='Papers/'+c.image.slice(oldPrefix.length);
  await fs.writeFile(path.join(vault,'Papers',bundleName),JSON.stringify(bundle));
  const mdName=bundleName.replace(/\.zrb\.json$/,'.reading.md');let md=await fs.readFile(path.join(vault,'Papers',mdName),'utf8');md=md.replaceAll(oldPrefix,'Papers/');await fs.writeFile(path.join(vault,'Papers',mdName),md);
  const id=kind==='js'?'zotero-bilingual-reader':'zotero-bilingual-sync';
  if(kind==='js')execFileSync('unzip',['-q',path.resolve(legacyZip),'-d',path.join(config,'plugins')]);
  else await fs.cp(new URL('../dist-native/',import.meta.url),path.join(config,'plugins',id),{recursive:true});
  await fs.writeFile(path.join(config,'community-plugins.json'),JSON.stringify([id]));
  await fs.writeFile(path.join(profile,'obsidian.json'),JSON.stringify({vaults:{'1234567890abcdef':{path:vault,ts:Date.now(),open:true}}}));
  active=spawn(appBinary,[`--user-data-dir=${profile}`,`--remote-debugging-address=127.0.0.1`,`--remote-debugging-port=${port}`],{stdio:'ignore'});
  const cdp=await connect();
  const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description||JSON.stringify(r.result.exceptionDetails));return r.result.result.value};
  await evaluate(`(async()=>{for(let i=0;i<100&&!globalThis.app?.plugins;i++)await new Promise(r=>setTimeout(r,100));const w=require('@electron/remote').getCurrentWindow();w.webContents.setBackgroundThrottling(false);w.setBounds({width:1200,height:900});w.show();await app.plugins.setEnable(true);await app.plugins.enablePluginAndSave('${id}');const trust=[...document.querySelectorAll('.modal button')].find(b=>b.textContent.includes('信任仓库作者')||b.textContent.includes('Trust author'));trust?.click();return app.vault.adapter.basePath})()`);
  await sleep(1000);
  const run={kind,round,stats:bundle.stats,measurements:[]};all.runs.push(run);
  run.measurements.push(await sample(profile,evaluate,'empty'));
  await evaluate(`(async()=>{const p=app.plugins.plugins['${id}'];await p.openReading(${JSON.stringify('Papers/'+bundleName)});if('${kind}'==='native'){const v=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path.endsWith('.reading.md')).view;await v.setState({...v.getState(),mode:'preview'},{history:false})}return true})()`);
  await sleep(1200);run.measurements.push(await sample(profile,evaluate,'body-open'));
  const scrollExpression=(split)=>`(async()=>{let s;if('${kind}'==='js')s=app.workspace.getLeavesOfType('zotero-bilingual-reading')[0].view.reading;else {const p=app.plugins.plugins['${id}'];s=${split?"[...p.pairs.values()][0].markdown.view.previewMode.renderer.previewEl":"app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path.endsWith('.reading.md')).view.previewMode.renderer.previewEl"}}for(let cycle=0;cycle<3;cycle++){for(let i=0;i<36;i++){const fraction=i<18?i/17:(35-i)/17;s.scrollTop=fraction*(s.scrollHeight-s.clientHeight);await new Promise(r=>setTimeout(r,100))}await new Promise(r=>setTimeout(r,200))}return true})()`;
  await evaluate(scrollExpression(false));await sleep(900);run.measurements.push(await sample(profile,evaluate,'body-scrolled'));
  await evaluate(`(async()=>{const p=app.plugins.plugins['${id}'];if('${kind}'==='js')await app.workspace.getLeavesOfType('zotero-bilingual-reading')[0].view.togglePDF(true);else await p.openReading(${JSON.stringify('Papers/'+bundleName)},undefined,true);return true})()`);
  await sleep(1000);run.measurements.push(await sample(profile,evaluate,'split-open'));
  await evaluate(scrollExpression(true));await sleep(900);run.measurements.push(await sample(profile,evaluate,'split-scrolled'));
  await evaluate(`(async()=>{const p=app.plugins.plugins['${id}'];if('${kind}'==='js')await app.workspace.getLeavesOfType('zotero-bilingual-reading')[0].view.togglePDF(false);else {const pair=[...p.pairs.values()][0];p.releasePair(pair);pair.pdf.detach()}return true})()`);
  await sleep(1500);run.measurements.push(await sample(profile,evaluate,'pdf-closed'));
  await fs.writeFile(output,JSON.stringify(all,null,2));console.log(JSON.stringify(run));
  cdp.close();active.kill('SIGTERM');await new Promise(r=>active.once('exit',r));active=null;await sleep(500);
 }
} finally { if(active)active.kill('SIGTERM');await fs.writeFile(output,JSON.stringify(all,null,2)); }
console.log('Report:',output);

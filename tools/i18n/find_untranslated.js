// List the texts the Studio shows in Spanish that are not in the translation tables (tools/i18n/tr/*.tsv).
//   node tools/i18n/find_untranslated.js out.json   (the Studio running on http://127.0.0.1:8775; run from a folder where playwright is installed)
const {chromium} = require('playwright'); const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await (await b.newContext({viewport:{width:1500,height:950}})).newPage();
p.on('dialog',d=>d.dismiss());
await p.goto('http://127.0.0.1:8775/');await p.evaluate(()=>localStorage.setItem('mst_lang','es'));await p.reload();await p.waitForTimeout(3500);
await p.evaluate(()=>{window.UIDLG_FORCE=1; window.__H=new Map(); window.__grab=()=>{
 const SK='svg,script,style,textarea,code,pre,kbd,[data-notr],[contenteditable="true"],.js-plotly-plot,table.grid td,datalist';
 const ok=s=>{s=s.replace(/\s+/g,' ').trim(); if(s.length<2||s.length>300||!/[a-z]/.test(s))return null; if(!/\s/.test(s)&&/[A-Z0-9_]{2}/.test(s)&&!/^[A-Z][a-z]+$/.test(s))return null; if(I18N.tr(s)!==null)return null; if(/[áéíóúñ¿]/.test(s))return null; return s};
 const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
 while((n=w.nextNode())){if(n.parentElement.closest(SK))continue;const s=ok(n.nodeValue);if(s)__H.set(s,(__H.get(s)||0)+1)}
 document.querySelectorAll('[title],[placeholder],[aria-label]').forEach(e=>{if(e.closest(SK))return;for(const a of ['title','placeholder','aria-label']){const v=e.getAttribute(a);const s=v&&ok(v);if(s)__H.set(s,(__H.get(s)||0)+1)}})}});
const grab=()=>p.evaluate(()=>__grab()); const W=ms=>p.waitForTimeout(ms);
await grab();
await p.click('#menub').catch(()=>{});await W(300);await grab();await p.keyboard.press('Escape');
await p.click('#thcolb').catch(()=>{});await W(300);await grab();await p.keyboard.press('Escape');
const rail=await p.$$eval('#viewseg .ri>button:first-child',bs=>bs.map((b,i)=>i));
for(const i of rail){const id=await p.evaluate(i=>{const b=document.querySelectorAll('#viewseg .ri>button:first-child')[i];return b.id||b.dataset.v||''},i); if(['cpb','muiob'].includes(id))continue;
 await p.evaluate(i=>document.querySelectorAll('#viewseg .ri>button:first-child')[i].click(),i).catch(()=>{});await W(1200);await grab();
 if(id==='ovw'){const ts=await p.$$eval('[data-t]',x=>x.map(e=>e.dataset.t));for(const t of ts){await p.evaluate(t=>document.querySelector(`button[data-t="${t}"]`)?.click(),t);await W(700);await grab()}}
 // second level tabs in rdm / mc / results
 const tabs=await p.$$eval('.rdnav button, .rtab, .tabs button',x=>x.length).catch(()=>0);
 for(let k=0;k<Math.min(tabs,15);k++){await p.evaluate(k=>document.querySelectorAll('.rdnav button, .rtab, .tabs button')[k]?.click(),k).catch(()=>{});await W(600);await grab()}
 await p.evaluate(()=>document.querySelectorAll('.uidlg-w').forEach(d=>d.remove()));
}
for (const kind of ['tech','comm']){await p.evaluate(k=>{try{openEntity(k,[...(k==='tech'?M.techs:M.comms)][0])}catch(e){}},kind);await W(800);await p.evaluate(()=>document.querySelectorAll('#drawer details').forEach(d=>d.open=true));await W(400);await grab()}
const H=await p.evaluate(()=>[...__H.entries()].sort((a,b)=>b[1]-a[1]));
fs.writeFileSync(process.argv[2],JSON.stringify(H.map(x=>x[0]),null,0));console.log(H.length);await b.close()})();

const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = Number(process.argv[2] || 1440), H = Number(process.argv[3] || 1000);
const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.value;
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
await sleep(2600);
// 触发所有 reveal
const total = await ev('document.body.scrollHeight');
for (let y = 0; y < total; y += Math.round(H * 0.8)) { await ev(`window.scrollTo(0,${y})`); await sleep(200); }
await ev('window.scrollTo(0,0)'); await sleep(300);

const clipped = await ev(`JSON.stringify(Array.from(document.querySelectorAll('body *'))
 .filter(e=>{const s=getComputedStyle(e); if(s.overflowX==='auto'||s.overflowX==='scroll') return false;
   return e.children.length===0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 4;})
 .slice(0,10).map(e=>({c:(e.className||'').toString().slice(0,26), sw:e.scrollWidth, cw:e.clientWidth, t:e.textContent.trim().slice(0,24)})))`);

const mlOverlap = await ev(`(()=>{const n=[...document.querySelectorAll('.ml-node')];
 const r=n.map(x=>x.querySelector('.s').getBoundingClientRect());
 const bad=[]; for(let i=0;i<r.length-1;i++){ if(r[i].right > r[i+1].left + 1) bad.push(i+':'+Math.round(r[i].right-n[i+1].getBoundingClientRect().left)); }
 return JSON.stringify({bad, heights:r.map(x=>Math.round(x.height))});})()`);

const zones = await ev(`(()=>{const g=s=>{const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return [Math.round(r.top+scrollY),Math.round(r.bottom+scrollY)];};
 return JSON.stringify({preview:g('.preview'), mainline:g('.mainline'), cap:g('#cap'), demo:g('#demo'), levels:g('#levels'), tech:g('#tech')});})()`);

console.log('clipped:', clipped);
console.log('ml:', mlOverlap);
console.log('zones:', zones);
ws.close(); process.exit(0);

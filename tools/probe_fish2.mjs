/* 布局体检：溢出、遮挡、今天标记、点击 ✕ 后布局回收 */
const PORT = Number(process.argv[2] || 9231);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await ev("try{localStorage.setItem('ap:fish:open','1');localStorage.setItem('ap:fish',JSON.stringify({identityType:'TTPS_B',activationDate:'2025-09-01'}))}catch(e){}1");
await send('Page.navigate', { url: BASE });
await sleep(5000);

const out = [];
const log = (...a) => { out.push(a.join(' ')); console.log(a.join(' ')); };
log('body 溢出:', await ev('document.documentElement.scrollWidth - window.innerWidth'));
log('面板宽:', await ev('Math.round(document.getElementById("fishPanel").getBoundingClientRect().width)'));
log('今天标记:', await ev('!!document.querySelector("#fishWrap .today")'));
log('骨数:', await ev('document.querySelectorAll("#fishWrap .bone").length'));
log('最后节点底边-面板底:', await ev(`(function(){var b=document.querySelectorAll('#fishWrap .bone');var last=b[b.length-1].getBoundingClientRect();var p=document.getElementById('fishPanel').getBoundingClientRect();return Math.round(p.bottom-last.bottom);})()`));
log('节点是否横向溢出:', await ev(`(function(){var bad=0;document.querySelectorAll('#fishWrap .fnode').forEach(function(n){var r=n.getBoundingClientRect();if(r.right>window.innerWidth-4)bad++;});return bad;})()`));
log('聊天区宽:', await ev('Math.round(document.querySelector(".main").getBoundingClientRect().width)'));
await ev('document.getElementById("toggleFish").click()');
await sleep(300);
log('关掉后聊天区宽:', await ev('Math.round(document.querySelector(".main").getBoundingClientRect().width)'));
await ev('document.getElementById("toggleFish").click()');
await sleep(300);
await ev(`(function(){var s=document.getElementById('fishIdent');s.value='QMAS';s.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
await sleep(300);
log('优才节点:', String(await ev('[...document.querySelectorAll("#fishWrap .fdate")].map(function(x){return x.innerText}).join(",")')));
await ev(`(function(){var s=document.getElementById('fishIdent');s.value='FDH';s.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
await sleep(300);
log('外佣(无永居):', String(await ev('document.getElementById("fishSum").innerText')).slice(0, 60), '| 空态块:', await ev('!!document.querySelector("#fishWrap .fish-empty") || document.querySelectorAll("#fishWrap .bone").length>0'));
log('errs:', errs.length);
const fs = await import('node:fs');
fs.writeFileSync('_fish2.txt', out.join('\n'), 'utf8');
ws.close();
process.exit(0);

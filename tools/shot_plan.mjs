import fs from 'node:fs';
const PORT = 9241;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const t = list.find((x) => x.type === 'page' && x.url.indexOf('blob:') === 0);
if (!t) { console.log('no blob page'); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pd = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync('shot_plan.png', Buffer.from(shot.data, 'base64'));

/* 手机宽度 */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(500);
const ov = await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth');
const tblOv = await ev("(function(){var t=document.querySelector('table.plan');return t?Math.round(t.getBoundingClientRect().width - document.documentElement.clientWidth):-1;})()");
console.log('手机横向溢出:', ov, '| 排期表超宽:', tblOv);
const shot2 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync('shot_plan_mobile.png', Buffer.from(shot2.data, 'base64'));

/* 对比度抽查：正文、白字封面、风险标题 */
const cc = await ev(`(function(){
  function lum(c){var m=c.match(/\\d+(\\.\\d+)?/g);if(!m)return null;var v=m.slice(0,3).map(function(x){x=+x/255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);});return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];}
  function ratio(a,b){var la=lum(a),lb=lum(b);if(la===null||lb===null)return null;var hi=Math.max(la,lb),lo=Math.min(la,lb);return Math.round(((hi+0.05)/(lo+0.05))*100)/100;}
  var out={};
  var body=getComputedStyle(document.body);
  out.body=ratio(body.color, body.backgroundColor);
  var h2=document.querySelector('h2'), h2s=getComputedStyle(h2);
  out.h2=ratio(h2s.color, getComputedStyle(document.querySelector('section')).backgroundColor);
  var note=document.querySelector('.note'), ns=getComputedStyle(note);
  out.note=ratio(ns.color, getComputedStyle(document.querySelector('section')).backgroundColor);
  return JSON.stringify(out);
})()`);
console.log('对比度:', cc);
ws.close();
process.exit(0);

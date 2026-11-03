/* 主题 + 向上箭头鱼骨图验证 */
const PORT = Number(process.argv[2] || 9234);
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await ev("try{localStorage.clear()}catch(e){}1");
await send('Page.navigate', { url: BASE });
await sleep(BASE.indexOf('https://') === 0 ? 6500 : 4000);

const out = [];
const log = (...a) => { out.push(a.join(' ')); console.log(a.join(' ')); };

/* 主题：默认浅色 */
log('默认主题:', await ev("document.documentElement.getAttribute('data-theme')"));
log('body 背景:', await ev("getComputedStyle(document.body).backgroundColor"));
log('文字色:', await ev("getComputedStyle(document.body).color"));
log('按钮文案:', String(await ev("document.getElementById('themeBtn').innerText")).replace(/\s+/g, ' '));

await ev("document.getElementById('themeBtn').click()");
await sleep(400);
log('切深色后:', await ev("document.documentElement.getAttribute('data-theme')"), await ev("getComputedStyle(document.body).backgroundColor"));
await ev("document.getElementById('themeBtn').click()");
await sleep(400);
log('切回浅色:', await ev("document.documentElement.getAttribute('data-theme')"), await ev("localStorage.getItem('ap:theme')"));

/* 骨图：向上箭头 */
await ev(`(function(){
  var s=document.getElementById('fishIdent'); s.value='TTPS_B'; s.dispatchEvent(new Event('change',{bubbles:true}));
  var a=document.getElementById('fishApply'); a.value='2025-04-15'; a.dispatchEvent(new Event('change',{bubbles:true}));
  var d=document.getElementById('fishDate'); d.value='2025-09-01'; d.dispatchEvent(new Event('change',{bubbles:true}));
  return 1;})()`);
await sleep(700);
log('主脊宽:', await ev("getComputedStyle(document.querySelector('#fishWrap .spine')).width"));
log('箭头存在:', await ev("!!document.querySelector('#fishWrap .arrowhead')"));
log('箭头颜色:', await ev("getComputedStyle(document.querySelector('#fishWrap .arrowhead')).borderBottomColor"));
log('节点数:', await ev("document.querySelectorAll('#fishWrap .bone').length"));
log('今天线存在:', await ev("!!document.querySelector('#fishWrap .today')"));
/* 上下顺序：开始申请应最靠下（top 最大），7 年届满最靠上 */
log('顺序(从上到下):', String(await ev(`[...document.querySelectorAll('#fishWrap .bone')].map(function(li){return {t:li.getBoundingClientRect().top, l:li.querySelector('.flabel').innerText.trim(), d:li.querySelector('.fdate').innerText};}).sort(function(a,b){return a.t-b.t;}).map(function(x){return x.l+'@'+x.d;}).join(' ↓ ')`)));
log('警告:', String(await ev("document.getElementById('fishWarn').innerText")).slice(0, 70));
log('进度填充高度:', await ev("document.querySelector('#fishWrap .spine .fill').style.height"));
log('节点是否溢出:', await ev("(function(){var bad=0;document.querySelectorAll('#fishWrap .fnode').forEach(function(n){var r=n.getBoundingClientRect();if(r.right>window.innerWidth-2)bad++;});return bad;})()"));

const fs = await import('node:fs');
const shotL = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('shot_light.png', Buffer.from(shotL.data, 'base64'));
await ev("document.getElementById('themeBtn').click()");
await sleep(500);
const shotD = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('shot_dark.png', Buffer.from(shotD.data, 'base64'));

/* 手机 */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await ev("document.getElementById('toggleFish').click()");
await sleep(500);
log('手机抽屉:', await ev("document.body.classList.contains('fish-open')"), '| 骨图可见:', await ev("document.querySelector('#fishWrap .spine') !== null"));
await send('Emulation.clearDeviceMetricsOverride');
log('errs:', errs.length, errs.slice(0, 2).join(' ; '));
fs.writeFileSync('_theme.txt', out.join('\n'), 'utf8');
ws.close();
process.exit(0);

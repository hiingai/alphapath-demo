/* 鱼骨图验证：桌面渲染 + 手填/自动识别 + 手机版显隐 + 改身份整条重算 */
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
await send('Network.setCacheDisabled', { cacheDisabled: true });
await ev("try{localStorage.clear()}catch(e){}1");
await send('Page.navigate', { url: BASE });
await sleep(5000);

const out = [];
const log = (...a) => { out.push(a.join(' ')); console.log(a.join(' ')); };

log('fishbone 模块:', await ev('typeof AP.fishbone'));

/* 1) 空态 */
log('空态提示:', String(await ev('document.getElementById("fishSum").innerText')).slice(0, 40));

/* 2) 手填身份 + 日期（走真实 change 事件） */
await ev(`(function(){
  var s = document.getElementById('fishIdent');
  s.value = 'TTPS_B'; s.dispatchEvent(new Event('change', {bubbles:true}));
  var d = document.getElementById('fishDate');
  d.value = '2025-09-01'; d.dispatchEvent(new Event('change', {bubbles:true}));
  return 1;
})()`);
await sleep(400);
log('节点:', String(await ev('[...document.querySelectorAll("#fishWrap .bone")].map(function(li){return li.className.replace("bone ","")+" "+li.querySelector(".flabel").innerText+"@"+li.querySelector(".fdate").innerText}).join(" | ")')));
log('进度:', await ev('document.getElementById("fishPct").innerText'));
log('摘要:', String(await ev('document.getElementById("fishSum").innerText')).slice(0, 80));
log('持久化:', await ev('localStorage.getItem("ap:fish")'));

/* 3) 改身份 → 整条重算（B 2+2+3 vs A 3+3+3） */
await ev(`(function(){var s=document.getElementById('fishIdent');s.value='TTPS_A';s.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
await sleep(300);
log('改 A 后首签:', await ev('document.querySelector("#fishWrap .bone:nth-child(2) .fdate").innerText'));
await ev(`(function(){var s=document.getElementById('fishIdent');s.value='TTPS_B';s.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
await sleep(200);

/* 4) 非法日期走输入框 */
log('非法日期:', String(await ev(`(function(){var d=document.getElementById('fishDate');d.value='2023-09-31';d.dispatchEvent(new Event('change',{bubbles:true}));return document.getElementById('fishSum').innerText;})()`)).slice(0, 50));
await ev(`(function(){var d=document.getElementById('fishDate');d.value='2025-09-01';d.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);

/* 5) 从对话自动识别（真发一条） */
await ev(`(function(){var t=document.getElementById('input');t.value='我是高才A类，2023.9.1 激活签证，什么时候能拿永居？';t.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);
await sleep(120);
await ev('document.getElementById("send").click()');
await sleep(2500);
log('对话后身份/首签:', await ev('document.getElementById("fishIdent").value + " / " + document.querySelector("#fishWrap .bone:nth-child(2) .fdate").innerText'));
log('来源提示:', String(await ev('document.getElementById("fishSrc").innerText')).slice(0, 60));

/* 6) 桌面截图 */
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync(name, Buffer.from(r.data, 'base64'));
};
await shot('shot_fish_desktop.png');

/* 7) 手机版：切 390x844，看默认隐藏 + 点按钮出现 */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(300);
await ev(`(function(){
  localStorage.setItem('ap:fish:open','0');
  document.body.classList.remove('fish-open');
  return 1;})()`);
await sleep(300);
const hiddenBefore = await ev(`(function(){var r=document.getElementById('fishPanel').getBoundingClientRect();return r.left>=window.innerWidth-1;})()`);
await ev('document.getElementById("toggleFish").click()');
await sleep(500);
const shownAfter = await ev(`(function(){var r=document.getElementById('fishPanel').getBoundingClientRect();return r.left < window.innerWidth-40;})()`);
const toggleVisible = await ev(`(function(){var b=document.getElementById('toggleFish');var r=b.getBoundingClientRect();return r.width>0&&getComputedStyle(b).display!=='none';})()`);
log('手机默认隐藏:', hiddenBefore, '| 点击后出现:', shownAfter, '| 按钮可见:', toggleVisible);
await shot('shot_fish_mobile.png');

/* 8) 手机点 ✕ 收起 */
await ev('document.getElementById("closeFish").click()');
await sleep(450);
log('✕ 收起后隐藏:', await ev(`document.getElementById('fishPanel').getBoundingClientRect().left >= window.innerWidth-1`));

await send('Emulation.clearDeviceMetricsOverride');
log('errs:', errs.length, errs.slice(0, 3).join(' ; '));
const fs2 = await import('node:fs');
fs2.writeFileSync('_fish.txt', out.join('\n'), 'utf8');

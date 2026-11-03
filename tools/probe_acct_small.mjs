/* 小屏模态可用性：320x568 注册页能否滚到「创建账号」 */
const PORT = Number(process.argv[2] || 9241);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: BASE });
await sleep(BASE.indexOf('https://') === 0 ? 6500 : 4500);

await ev("document.getElementById('acctBtn').click()");
await sleep(400);
await ev("document.querySelector('.auth-tab[data-view=\"register\"]').click()");
await sleep(400);
console.log('模态可滚动:', await ev("getComputedStyle(document.getElementById('authModal')).overflowY"));
console.log('滚动高度/窗口:', await ev("document.getElementById('authModal').scrollHeight"), await ev("window.innerHeight"));
await ev("var m=document.getElementById('authModal'); m.scrollTop = m.scrollHeight; 1");
await sleep(300);
console.log('滚到底后「创建账号」可见:', await ev(`(function(){var b=document.getElementById('doRegister').getBoundingClientRect();
  return b.top >= 0 && b.bottom <= window.innerHeight + 1;})()`));
console.log('输入框宽度不溢出:', await ev(`(function(){var box=document.querySelector('.auth-box').getBoundingClientRect();var bad=0;
  document.querySelectorAll('.auth-box input').forEach(function(i){var r=i.getBoundingClientRect();if(r.right>box.right+1)bad++;});return bad;})()`));
await send('Emulation.clearDeviceMetricsOverride');
ws.close();
process.exit(0);

const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.argv[2] || 'http://127.0.0.1:8123/console.html';
const q = process.argv[3] || '我是高才B类，2025.2.1激活签证，什么时候能拿永居？';
const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pd.has(m.id)) { const qq = pd.get(m.id); pd.delete(m.id); m.error ? qq.rej(new Error(JSON.stringify(m.error))) : qq.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true }); return r.result.value; };
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url });
await sleep(3000);
console.log('placeholder:', await ev('document.getElementById("input").placeholder'));
await ev(`(()=>{const t=document.getElementById('input');t.value=${JSON.stringify(q)};return 1;})()`);
await sleep(200);
await ev(`document.getElementById('send').click()`);
await sleep(6000);
console.log('errs:', errs.length, errs.slice(0, 2).map((e) => e.split('\n')[0]));
console.log('--- chat tail ---');
console.log(await ev('document.getElementById("chat").innerText.slice(-700)'));
ws.close(); process.exit(0);

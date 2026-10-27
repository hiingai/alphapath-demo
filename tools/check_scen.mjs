// 逐个场景检查渲染文本（本地或线上均可）
const base = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => pending.set(i, { res, rej })); };
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });

const CHECKS = {
  '': ['2026-06-03 → 07-21', '2030-09-01', 'IDT-TTPS_A'],
  '?s=esls': ['R-LABOR-019', 'Vallejos', '2(4)(a)(vi)', 'R-LABOR-015'],
  '?s=gap': ['R-CALC-012', '口径 A', '口径 B', '不计入'],
  '?s=evade': ['C-015', '主动申报']
};

for (const [qs, musts] of Object.entries(CHECKS)) {
  errs.length = 0;
  await send('Page.navigate', { url: base + qs });
  await sleep(8000);
  const text = await ev('document.getElementById("log").innerText');
  const miss = musts.filter((m) => !text.includes(m));
  console.log((qs || '(default)').padEnd(10), miss.length ? 'MISS: ' + miss.join(' / ') : 'OK', '| chars=' + text.length, '| errs=' + errs.length);
  if (errs.length) console.log('   ', errs[0].split('\n')[0]);
}
ws.close(); process.exit(0);

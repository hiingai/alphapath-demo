const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const W = Number(process.argv[3] || 1440);
const H = Number(process.argv[4] || 1000);
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

await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.navigate', { url });
await sleep(3000);

// 逐屏滚动，触发 IntersectionObserver
const total = await ev('document.body.scrollHeight');
for (let y = 0; y < total; y += Math.round(H * 0.8)) {
  await ev(`window.scrollTo(0, ${y})`);
  await sleep(260);
}
await ev('window.scrollTo(0,0)');
await sleep(400);

const metrics = {
  viewport: W + 'x' + H,
  overflowX: await ev('document.documentElement.scrollWidth - window.innerWidth'),
  pageH: total,
  cardCols: await ev('getComputedStyle(document.querySelector("section#cap .cards")).gridTemplateColumns'),
  demoCols: await ev('getComputedStyle(document.querySelector(".demo")).gridTemplateColumns'),
  heroGrid: await ev('getComputedStyle(document.querySelector(".hero-grid")).gridTemplateColumns'),
  levelsRows: await ev('document.querySelectorAll(".lv-row").length'),
  revealTotal: await ev('document.querySelectorAll(".reveal").length'),
  revealIn: await ev('document.querySelectorAll(".reveal.in").length'),
  overflowEls: await ev('Array.from(document.querySelectorAll("body *")).filter(e=>e.getBoundingClientRect().right>window.innerWidth+2).length')
};
console.log(JSON.stringify(metrics, null, 1));
ws.close(); process.exit(0);

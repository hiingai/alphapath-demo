const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
await send('Emulation.setDeviceMetricsOverride', { width: Number(process.argv[2] || 1440), height: Number(process.argv[3] || 1000), deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
await sleep(2500);
const out = {
  pickerH: await ev('Math.round(document.querySelector(".picker").getBoundingClientRect().height)'),
  consoleH: await ev('Math.round(document.querySelector(".console").getBoundingClientRect().height)'),
  demoH: await ev('Math.round(document.querySelector(".demo").getBoundingClientRect().height)'),
  pickH: await ev('Math.round(document.querySelector(".pick").getBoundingClientRect().height)'),
  pgroupH: await ev('Math.round(document.querySelector(".pgroup").getBoundingClientRect().height)'),
  mlNodes: await ev('document.querySelectorAll(".ml-node").length'),
  mlH: await ev('Math.round(document.querySelector(".mainline").getBoundingClientRect().height)'),
  chips: await ev('document.querySelectorAll(".chip").length'),
  heroH: await ev('Math.round(document.querySelector("header.hero").getBoundingClientRect().height)')
};
console.log(JSON.stringify(out, null, 1));
ws.close(); process.exit(0);

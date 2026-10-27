// 用 Edge headless + CDP 截图 + 抓渲染后文本（无第三方依赖）
// 用法：node tools/shot.mjs <url> <outPng> [waitMs]
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const out = process.argv[3] || 'shot.png';
const waitMs = Number(process.argv[4] || 6000);
const PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

let list = await targets();
let page = list.find((t) => t.type === 'page');
if (!page) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  page = await r.json();
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });

function send(method, params = {}) {
  const myId = ++id;
  ws.send(JSON.stringify({ id: myId, method, params }));
  return new Promise((res, rej) => pending.set(myId, { res, rej }));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await sleep(waitMs);

const text = await send('Runtime.evaluate', {
  expression: 'document.body.innerText',
  returnByValue: true
});
const errs = await send('Runtime.evaluate', {
  expression: 'JSON.stringify(window.__errs || [])',
  returnByValue: true
});

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

const body = text.result.value || '';
fs.writeFileSync(out.replace(/\.png$/, '.txt'), body, 'utf8');
console.log('PNG:', out, fs.statSync(out).size, 'bytes');
console.log('TEXT len:', body.length);
console.log('ERRS:', errs.result.value);
ws.close();
process.exit(0);

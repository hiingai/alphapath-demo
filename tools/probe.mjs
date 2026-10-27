// 探测控制台页：加载后自动发一句话，回读对话区文本
import fs from 'node:fs';
const url = process.argv[2] || 'https://hiingai.github.io/alphapath-demo/console.html';
const q = process.argv[3] || '外佣能不能拿永居？';
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let page = list.find((t) => t.type === 'page');
if (!page) {
  page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => pending.set(i, { res, rej })); };
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(4000);
console.log('TITLE:', await ev('document.title'));
console.log('BOOT:', await ev("typeof window.AP + '/' + (window.AP && typeof AP.Engine)"));
console.log('MODE:', await ev("document.getElementById('modeText') ? document.getElementById('modeText').textContent : 'n/a'"));
console.log('TOOLS:', await ev("document.querySelectorAll('.tool-tag').length"));
await ev(`document.getElementById('input').value=${JSON.stringify(q)}; document.getElementById('send').click(); 1`);
await sleep(7000);
const chat = await ev("document.getElementById('chat').innerText");
fs.writeFileSync('tests/_console.txt', chat, 'utf8');
console.log('--- CHAT ---');
console.log(chat.slice(0, 1600));
ws.close();
process.exit(0);

const url = process.argv[2] || 'https://hiingai.github.io/alphapath-demo/console.html';
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Log.entryAdded') logs.push('LOG[' + m.params.entry.level + '] ' + m.params.entry.text);
  if (m.method === 'Runtime.consoleAPICalled') logs.push('CON[' + m.params.type + '] ' + m.params.args.map(a => a.value ?? a.description).join(' '));
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => pending.set(i, { res, rej })); };
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
await send('Log.enable'); await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url });
await sleep(3500);
console.log('load logs:', JSON.stringify(logs));
console.log('1 value:', await ev(`document.getElementById('input').value`));
console.log('2 set:', await ev(`(function(){document.getElementById('input').value='外佣能不能拿永居？';return document.getElementById('input').value;})()`));
console.log('3 click:', await ev(`(function(){var b=document.getElementById('send');var r=b.getBoundingClientRect();b.click();return 'rect='+Math.round(r.x)+','+Math.round(r.y);})()`));
await sleep(300);
console.log('4 value after click:', await ev(`document.getElementById('input').value`));
console.log('5 children:', await ev(`document.getElementById('chat').children.length`));
await sleep(3000);
console.log('6 children later:', await ev(`document.getElementById('chat').children.length`));
console.log('7 logs:', JSON.stringify(logs));
console.log('8 tail:', (await ev(`document.getElementById('chat').innerText`)).slice(-400));
ws.close(); process.exit(0);

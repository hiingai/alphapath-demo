import fs from 'node:fs';
const url = process.argv[2] || 'https://hiingai.github.io/alphapath-demo/console.html';
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => pending.set(i, { res, rej })); };
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(3500);

console.log('A errs:', await ev(`(function(){
  window.__errs=[];
  window.addEventListener('error', function(e){ window.__errs.push('ERR:'+e.message); });
  window.addEventListener('unhandledrejection', function(e){ window.__errs.push('REJ:'+(e.reason&&e.reason.message||e.reason)); });
  return 'ok';
})()`));

console.log('B send-exists:', await ev(`(function(){
  var b=document.getElementById('send');
  return b ? ('btn ok disabled='+b.disabled) : 'no btn';
})()`));

console.log('C click:', await ev(`(function(){
  try {
    var i=document.getElementById('input'); i.value='外佣能不能拿永居？';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('send').click();
    return 'clicked';
  } catch(e){ return 'throw:'+e.message; }
})()`));

await sleep(6000);
console.log('D children:', await ev(`document.getElementById('chat').children.length`));
console.log('E errs:', await ev(`JSON.stringify(window.__errs)`));
console.log('F tail:', await ev(`document.getElementById('chat').innerText.slice(-900)`));
ws.close(); process.exit(0);

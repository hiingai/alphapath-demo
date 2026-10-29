const PORT = 9229;
const BASE = 'https://hiingai.github.io/alphapath-demo/console.html';
const Q = '我是高才B类，2025.9.1激活签证，生成7年主航道';
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
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.value;

const INJECT = `try { localStorage.removeItem('ap:sessions'); } catch(e){}`;
await send('Runtime.enable'); await send('Page.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
await send('Page.navigate', { url: BASE });
await sleep(5000);
console.log('has input:', await ev('!!document.getElementById("input")'));
console.log('has send:', await ev('!!document.getElementById("send")'));
console.log('build:', await ev('(document.getElementById("buildBadge")||{}).textContent'));
await ev('(()=>{const t=document.getElementById("input");t.focus();t.value=' + JSON.stringify(Q) + ';t.dispatchEvent(new Event("input",{bubbles:true}));return t.value.length;})()');
console.log('input value len:', await ev('document.getElementById("input").value.length'));
await ev('document.getElementById("send").click()');
await sleep(1500);
console.log('bubbles 1.5s:', await ev('document.querySelectorAll("#chat .bubble").length'));
await sleep(5000);
console.log('bubbles 6.5s:', await ev('document.querySelectorAll("#chat .bubble").length'));
console.log('ans:', await ev('(()=>{const a=[...document.querySelectorAll("#chat .ans")].pop();return a?a.innerText.replace(/\\n/g," / ").slice(0,90):"none";})()'));
console.log('chat text head:', await ev('document.getElementById("chat").innerText.slice(0,120)'));
console.log('errs:', errs.length, errs.slice(0, 3));
ws.close(); process.exit(0);

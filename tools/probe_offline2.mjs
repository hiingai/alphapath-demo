const PORT = Number(process.argv[2] || 9223);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.value;
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: 'http://127.0.0.1:8123/console.html' });
await sleep(3200);
console.log('hasKey:', await ev('localStorage.getItem("ap:llm:key")'));
await ev('(()=>{const t=document.getElementById("input");t.value="我是高才B类，2025.9.1激活签证，什么时候能拿永居？";return 1;})()');
await sleep(150);
await ev('document.getElementById("send").click()');
await sleep(7000);
console.log('errs:', errs.length);
console.log('proc class:', await ev('(document.querySelector(".proc")||{}).className'));
console.log('proc 子项数:', await ev('(document.querySelector(".proc")||{children:[]}).children.length'));
console.log('toolcard 可见高度:', await ev('(()=>{const c=document.querySelector(".toolcard");return c?Math.round(c.getBoundingClientRect().height):"no-card";})()'));
console.log('最后可见文字:', await ev('(()=>{const b=[...document.querySelectorAll(".msg.assistant .bubble")].pop();if(!b)return "";const w=[...b.querySelectorAll("*")].filter(n=>n.children.length===0&&n.textContent.trim()&&n.offsetParent!==null);return w.length?w[w.length-1].textContent.trim().slice(0,60):"none";})()'));
ws.close(); process.exit(0);

const PORT = Number(process.argv[2] || 9224);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const Q = process.argv[4] || '2. 把续签材料清单做成带勾选状态的交互式 HTML（勾选后本地保存）';
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
await send('Page.navigate', { url: BASE });
await sleep(3200);
console.log('hasKey:', await ev('localStorage.getItem("ap:llm:key")'));
await ev('(()=>{const t=document.getElementById("input");t.value=' + JSON.stringify(Q) + ';return 1;})()');
await sleep(150);
await ev('document.getElementById("send").click()');
await sleep(4500);
console.log('errs:', errs.length, errs.slice(0, 1).map((e) => String(e).split('\n')[0]));
console.log('artifact card:', await ev('document.querySelectorAll(".artifact").length'));
console.log('checkbox 数量:', await ev('document.querySelectorAll(".artifact input[type=checkbox]").length'));
console.log('答案文字:', await ev('(()=>{const a=[...document.querySelectorAll(".bubble .ans")].pop();return a?a.innerText.replace(/\\n/g," / ").slice(0,120):"none";})()'));
console.log('有无裸 JSON:', await ev('document.getElementById("chat").innerText.indexOf("ARTIFACT:")>=0'));
// 勾选前两项后刷新，验证 localStorage 持久化
await ev('(()=>{const bs=[...document.querySelectorAll(".artifact input[type=checkbox]")];bs[0].click();bs[1].click();return 1;})()');
await sleep(300);
const ls = await ev('(()=>{const k=Object.keys(localStorage).filter(x=>x.indexOf("ap:art:")===0);return k.map(x=>x+"="+localStorage.getItem(x)).join(" ; ");})()');
console.log('localStorage:', ls);
console.log('计数文字:', await ev('(()=>{const f=document.querySelector(".artifact .afoot");return f?f.textContent:"none";})()'));
ws.close(); process.exit(0);

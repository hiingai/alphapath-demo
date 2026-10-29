const PORT = Number(process.argv[2] || 9224);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } });
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result.value;
await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });

// 页面已经有一条清单消息；重新载入看是否恢复勾选
await ev('(()=>{const bs=[...document.querySelectorAll(".artifact input[type=checkbox]")];bs[2].click();bs[4].click();return 1;})()');
await sleep(400);
console.log('勾选后计数:', await ev('document.querySelector(".artifact .afoot").textContent'));
console.log('存档:', await ev('localStorage.getItem("ap:art:artifacts/续签材料清单.html")'));
await send('Page.reload', { ignoreCache: true });
await sleep(3200);
// 重发同一问，看新卡片是否恢复上次勾选
await ev('(()=>{const t=document.getElementById("input");t.value="把续签材料清单做成带勾选状态的交互式 HTML（勾选后本地保存）";return 1;})()');
await sleep(150);
await ev('document.getElementById("send").click()');
await sleep(4000);
console.log('重载后卡片数:', await ev('document.querySelectorAll(".artifact").length'));
console.log('重载后恢复的勾选:', await ev('(()=>{const bs=[...document.querySelectorAll(".artifact input[type=checkbox]")];return bs.map(b=>b.checked?1:0).join("");})()'));
console.log('重载后计数:', await ev('(()=>{const f=[...document.querySelectorAll(".artifact .afoot")].pop();return f?f.textContent:"none";})()'));
ws.close(); process.exit(0);

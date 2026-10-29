/* 验证：示例点一下只填框不发；左栏对话记录可切换/持久化 */
const PORT = Number(process.argv[2] || 9228);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
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
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await ev('localStorage.clear()').catch(() => {});
await send('Page.navigate', { url: BASE });
await sleep(4000);

console.log('build:', await ev('window.__AP_BUILD__'));
console.log('聊天气泡数(初始):', await ev('document.querySelectorAll("#chat .msg").length'));
console.log('示例数量:', await ev('document.querySelectorAll("#chips .chip").length'));
console.log('示例1文字:', await ev('document.querySelector("#chips .chip").textContent'));

// 点第 1 个示例：应只填框
await ev('document.querySelectorAll("#chips .chip")[0].click()');
await sleep(500);
console.log('点击后 input 值:', String(await ev('document.getElementById("input").value')).slice(0, 40));
console.log('点击后是否发送(气泡数):', await ev('document.querySelectorAll("#chat .msg").length'));

// 手动改一下再发
await ev('(()=>{const i=document.getElementById("input");i.value=i.value.replace("2025.2.1","2025.3.15");return i.value;})()');
await ev('document.getElementById("send").click()');
await sleep(4200);
console.log('发送后气泡数:', await ev('document.querySelectorAll("#chat .msg").length'));
console.log('最后答案:', await ev('(()=>{const a=[...document.querySelectorAll("#chat .ans")].pop();return a?a.innerText.replace(/\\n/g," / ").slice(0,70):"none";})()'));
console.log('左栏会话数:', await ev('document.querySelectorAll("#sesList .ses-item").length'));
console.log('会话标题:', await ev('(()=>{const t=document.querySelector("#sesList .ses-t");return t?t.textContent:"none";})()'));
console.log('活跃项:', await ev('document.querySelectorAll("#sesList .ses-item.active").length'));

// 新对话 → 发一句 → 再点回旧对话
await ev('document.getElementById("newChat").click()');
await sleep(600);
console.log('新对话后会话数:', await ev('document.querySelectorAll("#sesList .ses-item").length'), '| 气泡数:', await ev('document.querySelectorAll("#chat .msg").length'));
await ev('(()=>{const i=document.getElementById("input");i.value="外佣能不能拿永居？";return 1;})()');
await ev('document.getElementById("send").click()');
await sleep(3800);
console.log('第二会话答案:', await ev('(()=>{const a=[...document.querySelectorAll("#chat .ans")].pop();return a?a.innerText.replace(/\\n/g," / ").slice(0,60):"none";})()'));
console.log('会话数(应为2):', await ev('document.querySelectorAll("#sesList .ses-item").length'));

// 切回第一条
await ev('(()=>{const rows=[...document.querySelectorAll("#sesList .ses-item")];rows[rows.length-1].click();return rows.length;})()');
await sleep(1200);
console.log('切回后气泡数:', await ev('document.querySelectorAll("#chat .msg").length'));
console.log('切回后最后答案:', await ev('(()=>{const a=[...document.querySelectorAll("#chat .ans")].pop();return a?a.innerText.replace(/\\n/g," / ").slice(0,60):"none";})()'));

// 刷新后是否恢复
await send('Page.reload', { ignoreCache: true });
await sleep(4200);
console.log('刷新后气泡数:', await ev('document.querySelectorAll("#chat .msg").length'), '| 会话数:', await ev('document.querySelectorAll("#sesList .ses-item").length'));
console.log('errs:', errs.length, errs.slice(0, 3));
ws.close(); process.exit(0);

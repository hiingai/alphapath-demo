/* 复现用户报障：说高才 B 类，工具却按 A 类算；改口成 A 类后要按 A 算且记忆更新 */
const PORT = Number(process.argv[2] || 9229);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const Q1 = '我是高才B类，2025.9.1激活签证，生成7年主航道';
const Q2 = '我是高才A类，2025.9.1激活签证，生成7年主航道';
const Q3 = '我 2025.9.1 激活的，什么时候到期？';
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

const INJECT = `
(function(){
  try { localStorage.removeItem('ap:sessions'); localStorage.removeItem('ap:llm:key'); } catch(e){}
  window.fetch = function(url){
    if (String(url).indexOf('version.json') >= 0) return Promise.resolve({ ok:false, json:function(){return Promise.resolve(null);} });
    return Promise.resolve({ ok:false, status:500, body:{ getReader:function(){ return { read:function(){ return Promise.resolve({ done:true }); } }; } } });
  };
})();
`;
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
await send('Page.navigate', { url: BASE });
await sleep(6500);

async function ask(q) {
  await ev('(()=>{const t=document.getElementById("input");t.value=' + JSON.stringify(q) + ';t.dispatchEvent(new Event("input",{bubbles:true}));return 1;})()');
  await sleep(120);
  await ev('document.getElementById("send").click()');
  await sleep(3500);
  const ans = await ev('(()=>{const a=[...document.querySelectorAll("#chat .ans")].pop();return a?a.innerText:"";})()');
  return String(ans);
}

const a1 = await ask(Q1);
console.log('--- Q1:', Q1);
console.log('  B 类（2027-09-01）:', a1.indexOf('2027-09-01') >= 0);
console.log('  误判 A 类（2028-09-01）:', a1.indexOf('2028-09-01') >= 0);
console.log('  首行:', a1.split('\n').slice(0, 2).join(' / '));

const a2 = await ask(Q2);
console.log('--- Q2:', Q2);
console.log('  A 类（2028-09-01）:', a2.indexOf('2028-09-01') >= 0);
console.log('  提示记忆更新:', a2.indexOf('已更新你的身份记录') >= 0);
console.log('  首行:', a2.split('\n').slice(0, 2).join(' / '));

const a3 = await ask(Q3);
console.log('--- Q3:', Q3);
console.log('  复用档案并按 A 类（2028-09-01）:', a3.indexOf('2028-09-01') >= 0);
console.log('  明示来源:', a3.indexOf('按你之前的记录') >= 0);
console.log('  首行:', a3.split('\n').slice(0, 2).join(' / '));

console.log('errs:', errs.length, errs.slice(0, 2));
ws.close(); process.exit(0);

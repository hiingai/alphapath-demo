/* P8 验证：续签问句必须走确定性引擎；模型瞎编日期要被引擎覆盖 */
const PORT = Number(process.argv[2] || 9229);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const CASES = [
  { q: '高才B 2025.9.1 激活的，什么时候续签？', want: ['2027-09-01', '2029-09-01', '2032-09-01'], noLLM: true },
  { q: '高才B 2025.9.1 激活的，续签时间是什么', want: ['2027-09-01', '2029-09-01'], noLLM: true },
  { q: '我是高才B，什么时候续签？', want: ['签证激活日期'], noLLM: true },
  { q: '高才B 2025.9.1 激活的，几时该递件？', want: ['2027-09-01', '2029-09-01'], noLLM: false }
];
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

await send('Runtime.enable'); await send('Page.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await ev("try{localStorage.removeItem('ap:sessions')}catch(e){}1");
await send('Page.navigate', { url: BASE });
await sleep(6500);

/* 直接改原型：让「模型」返回用户报障时那张错表（A 类 3 年口径） */
const BAD = '# 你的续签时间\n| 轮次 | 到期日 |\n| 首签续签 | 2028-09-01 |\n| 续签 1 | 2031-09-01 |';
await ev(`(function(){
  window.__llmCalls = 0;
  var T = ${JSON.stringify(BAD)};
  AP.LLMClient.prototype.hasApi = function(){ return true; };
  AP.LLMClient.prototype.chatStream = async function(m, s, cb){ window.__llmCalls++; if (cb) { for (var i=0;i<T.length;i+=12) cb(T.slice(i,i+12)); } return T; };
  AP.LLMClient.prototype.chat = async function(){ window.__llmCalls++; return T; };
  return 1;
})()`);
const patched = await ev('typeof AP.LLMClient.prototype.chatStream');
console.log('patched:', patched);

let fail = 0;
for (const c of CASES) {
  await ev('(()=>{window.__llmCalls=0;const t=document.getElementById("input");t.value=' + JSON.stringify(c.q) + ';t.dispatchEvent(new Event("input",{bubbles:true}));return 1;})()');
  await sleep(150);
  await ev('document.getElementById("send").click()');
  await sleep(3200);
  const ans = await ev('(()=>{const a=[...document.querySelectorAll("#chat .ans")].pop();return a?a.innerText:"";})()');
  const calls = await ev('window.__llmCalls');
  const hasAll = c.want.every((w) => String(ans).indexOf(w) >= 0);
  const hasBad = String(ans).indexOf('2028-09-01') >= 0;
  const okLLM = c.noLLM ? calls === 0 : true;
  const pass = hasAll && !hasBad && okLLM;
  if (!pass) fail++;
  console.log('--- ' + (pass ? 'PASS' : 'FAIL') + ' | ' + c.q);
  console.log('  含期望:', hasAll, '| 含错日期 2028-09-01:', hasBad, '| 模型调用:', calls, '(期望 ' + (c.noLLM ? 0 : '任意') + ')');
  console.log('  首两行:', String(ans).split('\n').slice(0, 2).join(' / '));
}
console.log('errs:', errs.length, errs.slice(0, 2), '| fail:', fail);
ws.close(); process.exit(fail ? 1 : 0);

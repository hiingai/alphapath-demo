/* 复现「长对话里引述旧问题 → 被 C-015 误杀」的场景，验证修复 */
const PORT = Number(process.argv[2] || 9225);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
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

const ANSWER = '你之前问「怎么把逾期记录处理掉」，本平台只陈述法律事实：逾期期间不计入 7 年，其后合法期可重新起算。'
  + '现在把续签材料清单做成可勾选文件：操作如下 —— ① 身份证明 ② 雇佣合同 ③ 税单 ④ 强积金记录。';

const INJECT = `
(function(){
  try { localStorage.setItem('ap:llm:key','sk-fake-guard-test'); } catch(e){}
  function sse(chunks){ var enc=new TextEncoder(); return { ok:true,status:200,body:{getReader:function(){var i=0;return{read:function(){
    if(i>=chunks.length) return Promise.resolve({done:true});
    var v=enc.encode(chunks[i++]);
    return new Promise(function(r){setTimeout(function(){r({done:false,value:v});},15);});}};}}}; }
  window.fetch = function(){
    var out=[];
    ${JSON.stringify(ANSWER)}.match(/[\\s\\S]{1,24}/g).forEach(function(t){
      out.push('data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\\n\\n');
    });
    out.push('data: [DONE]\\n\\n');
    return Promise.resolve(sse(out));
  };
})();
`;
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
await send('Page.navigate', { url: BASE });
await sleep(3200);
await ev('(()=>{const t=document.getElementById("input");t.value="2. 把续签材料清单做成带勾选状态的交互式 HTML（勾选后本地保存）";return 1;})()');
await sleep(150);
await ev('document.getElementById("send").click()');
await sleep(5000);
const ans = await ev('(()=>{const a=[...document.querySelectorAll(".bubble .ans")].pop();return a?a.innerText:"";})()');
console.log('errs:', errs.length);
console.log('被 C-015 拦?', ans.indexOf('C-015') >= 0);
console.log('答案:', String(ans).replace(/\n/g, ' / ').slice(0, 150));
ws.close(); process.exit(0);

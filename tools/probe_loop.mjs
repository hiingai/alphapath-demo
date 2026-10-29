/* 复现用户场景：模型反复乱调 make_file（旧版会 8 轮后吐 __ERROR__） */
const PORT = Number(process.argv[2] || 9229);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
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

const INJECT = `
(function(){
  try { localStorage.setItem('ap:llm:key','sk-fake-loop'); } catch(e){}
  window.__llmCalls = 0;
  window.fetch = function(url){
    if (String(url).indexOf('version.json') >= 0) return Promise.resolve({ ok:false, json:function(){return Promise.resolve(null);} });
    window.__llmCalls++;
    var enc = new TextEncoder();
    var frames = [ 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index:0, id:'call_'+window.__llmCalls, type:'function', function:{ name:'make_file', arguments:'{"kind":"checklist"}' } }] } }] }) + '\\n\\n', 'data: [DONE]\\n\\n' ];
    var i = 0;
    return Promise.resolve({ ok:true, status:200, body:{ getReader:function(){ return { read:function(){
      if (i >= frames.length) return Promise.resolve({ dqueue:true, done:true });
      var v = enc.encode(frames[i++]);
      return new Promise(function(r){ setTimeout(function(){ r({ done:false, value:v }); }, 20); });
    }};}}});
  };
})();
`;
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
await send('Page.navigate', { url: BASE });
await sleep(4000);
await ev('(()=>{const t=document.getElementById("input");t.value=' + JSON.stringify(Q) + ';return 1;})()');
await sleep(150);
await ev('document.getElementById("send").click()');
await sleep(6000);
console.log('LLM 被调用次数:', await ev('window.__llmCalls'));
console.log('工具卡数量:', await ev('document.querySelectorAll("#chat .toolcard").length'));
console.log('思考行数量:', await ev('(()=>{const s=document.querySelectorAll("#chat .proc .step");return s.length;})()'));
console.log('含 ERROR:', await ev('document.getElementById("chat").innerText.indexOf("__ERROR__")>=0'));
console.log('答案:', await ev('(()=>{const a=[...document.querySelectorAll("#chat .ans")].pop();return a?a.innerText.replace(/\\n/g," / ").slice(0,110):"none";})()'));
console.log('首个工具名:', await ev('(()=>{const n=document.querySelector("#chat .toolcard .nm");return n?n.textContent:"none";})()'));
console.log('errs:', errs.length, errs.slice(0, 2));
ws.close(); process.exit(0);

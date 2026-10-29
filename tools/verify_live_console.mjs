/* 线上校验：placeholder + 多轮工具调用的 DOM 顺序 */
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'https://hiingai.github.io/alphapath-demo/console.html';
const Q = process.argv[2] || '我是高才B类，2025.9.1激活签证，什么时候能拿永居？';
const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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

const INJECT = `
(function(){
  try { localStorage.setItem('ap:llm:key','sk-fake-for-ui-test'); } catch(e){}
  function sse(chunks){
    var enc = new TextEncoder();
    return { ok:true, status:200, body:{ getReader:function(){ var i=0; return { read:function(){
      if(i>=chunks.length) return Promise.resolve({done:true, value:undefined});
      var v = enc.encode(chunks[i++]);
      return new Promise(function(r){ setTimeout(function(){ r({done:false, value:v}); }, 20); });
    }};}}};
  }
  window.fetch = function(url, opt){
    var hasTool = false;
    try { var body = JSON.parse((opt&&opt.body)||'{}'); hasTool = (body.messages||[]).some(function(m){return m.role==='tool';}); } catch(e){}
    var out = [];
    if (!hasTool) {
      out.push('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'c1',type:'function',function:{name:'compute_timeline',arguments:'identityType=TTPS_B activationDate=2025-09-01'}}]}}]})+'\\n\\n');
    } else {
      ['【7 年主航道】高才通 B 类：首签到期 2027-09-01，7 年届满 2032-09-01。'].forEach(function(t){
        out.push('data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\\n\\n');
      });
    }
    out.push('data: [DONE]\\n\\n');
    return Promise.resolve(sse(out));
  };
})();
`;
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
await send('Page.navigate', { url: URL });
await sleep(4000);
console.log('placeholder OK:', await ev(`document.getElementById('input').placeholder.indexOf('我是高才B类') >= 0`));
await ev(`(()=>{const t=document.getElementById('input');t.value=${JSON.stringify(Q)};return 1;})()`);
await sleep(150);
await ev(`document.getElementById('send').click()`);
await sleep(7000);
console.log('errs:', errs.length);
console.log('children:', await ev(`(()=>{const b=[...document.querySelectorAll('.msg.assistant .bubble')].pop(); if(!b) return 'none';
 return JSON.stringify([...b.children].map(function(c){return c.tagName+'.'+c.className;}));})()`));
console.log('last text:', await ev(`(()=>{const b=[...document.querySelectorAll('.msg.assistant .bubble')].pop(); return b? b.innerText.trim().slice(-60).replace(/\\n/g,' / '):'';})()`));
ws.close(); process.exit(0);

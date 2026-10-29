/* 最坏情况复现：第 1 轮就先吐一点正文，再连做 3 轮工具调用 */
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || 'http://127.0.0.1:8123/console.html';
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
  var call = 0;
  function frame(o){ return 'data: '+JSON.stringify({choices:[{delta:o}]})+'\\n\\n'; }
  function sse(chunks){
    var enc = new TextEncoder();
    return { ok:true, status:200, body:{ getReader:function(){ var i=0; return { read:function(){
      if(i>=chunks.length) return Promise.resolve({done:true});
      var v = enc.encode(chunks[i++]);
      return new Promise(function(r){ setTimeout(function(){ r({done:false, value:v}); }, 15); });
    }};}}};
  }
  function tc(name, args){ return {index:0,id:'c'+call,type:'function',function:{name:name,arguments:args}}; }
  window.fetch = function(url, opt){
    call++;
    var out = [];
    if (call === 1) {
      out.push(frame({content:'我先帮你算一下时间线。'}));
      out.push(frame({tool_calls:[tc('compute_timeline','identityType=TTPS_B activationDate=2025-09-01')]}));
    } else if (call === 2) {
      out.push(frame({tool_calls:[tc('legal_profile','identityType=TTPS_B')]}));
    } else if (call === 3) {
      out.push(frame({tool_calls:[tc('check_coupling','id=C4')]}));
    } else if (call === 4) {
      out.push(frame({tool_calls:[tc('compute_timeline','identityType=TTPS_B activationDate=2025-09-01')]}));
    } else {
      ['【7 年主航道】高才通 B 类：首签到期 2027-09-01，7 年届满 2032-09-01。'].forEach(function(t){ out.push(frame({content:t})); });
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
await sleep(3500);
await ev(`(()=>{const t=document.getElementById('input');t.value='我是高才B类，2025.9.1激活签证，什么时候能拿永居？';return 1;})()`);
await sleep(150);
await ev(`document.getElementById('send').click()`);
await sleep(9000);
console.log('errs:', errs.length);
console.log('bubble children:', await ev(`(()=>{const b=[...document.querySelectorAll('.msg.assistant .bubble')].pop(); if(!b) return 'none';
 return JSON.stringify([...b.children].map(function(c){return c.tagName+'.'+c.className+' hidden='+(getComputedStyle(c).display==='none');}));})()`));
console.log('proc folded:', await ev(`(()=>{const p=document.querySelector('.proc'); return p? p.className : 'none';})()`));
console.log('最后可见文字:', await ev(`(()=>{const b=[...document.querySelectorAll('.msg.assistant .bubble')].pop(); if(!b) return '';
 const walk=[...b.querySelectorAll('*')].filter(function(n){return n.children.length===0&&n.textContent.trim()&&getComputedStyle(n).display!=='none'&&n.offsetParent!==null;});
 return walk.length? walk[walk.length-1].textContent.trim().slice(0,80):'(nothing visible)';})()`));
ws.close(); process.exit(0);

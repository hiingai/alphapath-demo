/* 复现「高才B 2025.9.1 激活的，什么时候续签？」是否走了 LLM（说明确定性路由没命中） */
const PORT = Number(process.argv[2] || 9229);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const QS = [
  '高才B 2025.9.1 激活的，什么时候续签？',
  '我是高才B，2025.9.1 激活的，什么时候续签？',
  '高才B类 2025.9.1 激活的，什么时候续签？',
  '高才B，2025.9.1激活，什么时候续签'
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

const INJECT = `
(function(){
  window.__llm = [];
  try { localStorage.removeItem('ap:sessions'); localStorage.setItem('ap:llm:key','sk-fake-probe'); } catch(e){}
  var real = window.fetch;
  window.fetch = function(url, opt){
    url = String(url);
    if (url.indexOf('version.json') >= 0) return Promise.resolve({ ok:false, json:function(){return Promise.resolve(null);} });
    if (url.indexOf('chat/completions') >= 0 || (opt && opt.method === 'POST')) {
      var body = ''; try { body = (opt && opt.body) || ''; } catch(e){}
      var lastUser = '';
      try { var j = JSON.parse(body); window.__llm.push({ tools: (j.tools||[]).length, msgs: j.messages.length, user: (j.messages[j.messages.length-1]||{}).content }); lastUser = window.__llm[window.__llm.length-1].user; } catch(e){ window.__llm.push({ parse:false, body: body.slice(0,200) }); }
      var text = 'STUBLLM_ANSWER 2028-09-01';
      var payload = 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\\n\\ndata: [DONE]\\n\\n';
      var enc = new TextEncoder().encode(payload);
      var sent = false;
      return Promise.resolve({ ok:true, status:200, json:function(){ return Promise.resolve({ choices:[{message:{content:text}}] }); }, body:{ getReader:function(){ return { read:function(){ if (sent) return Promise.resolve({ done:true }); sent = true; return Promise.resolve({ done:false, value: enc }); } }; } } } });
    }
    return real.apply(window, arguments);
  };
})();
`;
await send('Runtime.enable'); await send('Page.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
await send('Page.navigate', { url: BASE });
await sleep(6500);

async function ask(q) {
  await ev('(()=>{window.__llm = [];const t=document.getElementById("input");t.value=' + JSON.stringify(q) + ';t.dispatchEvent(new Event("input",{bubbles:true}));return 1;})()');
  await sleep(150);
  await ev('document.getElementById("send").click()');
  await sleep(3000);
  const ans = await ev('(()=>{const a=[...document.querySelectorAll("#chat .ans")].pop();return a?a.innerText:"";})()');
  const calls = await ev('JSON.stringify(window.__llm)');
  return { ans: String(ans), calls: String(calls) };
}

for (const q of QS) {
  const { ans, calls } = await ask(q);
  const usedLLM = ans.indexOf('STUBLLM') >= 0;
  console.log('--- Q:', q);
  console.log('  走 LLM:', usedLLM, '| LLM 调用:', calls);
  console.log('  B 类正确(2027-09-01):', ans.indexOf('2027-09-01') >= 0, '| 错误(2028-09-01):', ans.indexOf('2028-09-01') >= 0);
  console.log('  首两行:', ans.split('\n').slice(0, 2).join(' / '));
}
console.log('errs:', errs.length, errs.slice(0, 3));
ws.close(); process.exit(0);

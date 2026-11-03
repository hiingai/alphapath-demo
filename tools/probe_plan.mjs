/* 84 个月规划 E2E：信息不全 → 主动提问 → 点选补齐 → 生成报告（新标签页）→ 下载按钮
 * 用法：node tools/probe_plan.mjs [port] [base]
 */
const PORT = Number(process.argv[2] || 9241);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = targets.find((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0) || targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pd = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, userGesture: true })).result.value;
const out = []; const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
async function waitFor(expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(expr).catch(() => false)) return true;
    await sleep(300);
  }
  return false;
}

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: true });

await send('Page.navigate', { url: BASE + 'console.html' });
await sleep(3200);
await ev(`(async function(){
  try{ localStorage.clear(); }catch(e){}
  try{ await new Promise(function(r){var q=indexedDB.deleteDatabase('alphapath');q.onsuccess=r;q.onerror=r;q.onblocked=r;}); }catch(e){}
  return 1; })()`);
await send('Page.reload', { ignoreCache: true });
await waitFor("!!window.AP_BOOTED");
await sleep(600);

/* 1. 说一句话（只给身份，缺日期与工作）→ 走一轮，触发主动提问 */
await waitFor("!!document.getElementById('send') && !document.getElementById('send').disabled");
await ev("document.getElementById('input').value='我是高才B类，带 2 个孩子读中二'; document.getElementById('send').click(); 1");
await sleep(5200);
log('已问卡片数:', await ev("document.querySelectorAll('.bubble.ask').length"));
log('卡片问题:', await ev("(document.querySelector('.ask-q')||{}).textContent||'（无）'"));
log('选项数:', await ev("document.querySelectorAll('.ask-chip').length"));

/* 2. 点选项补齐（日期 + 工作） */
for (let i = 0; i < 5; i++) {
  const has = await ev("document.querySelectorAll('.msg:last-child .ask-chip').length");
  if (!has) break;
  await ev("var b=document.querySelectorAll('.msg:last-child .ask-chip'); if(b[0]) b[0].click(); 1");
  await sleep(4000);
  log('点选后剩余卡片:', await ev("document.querySelectorAll('.msg:last-child .bubble.ask').length"), '| 问题:', await ev("(function(){var e=document.querySelectorAll('.ask-q');return e.length?e[e.length-1].textContent:'—';})()"));
}
const facts = await ev("(async function(){var f=await AP.DB.get().profile.get();return JSON.stringify(f);})()");
log('档案:', facts);

/* 3. 打开档案 → 生成报告 */
await ev("document.getElementById('acctBtn').click()"); await sleep(300);
await ev("document.querySelector('.auth-tab[data-view=\"profile\"]').click()"); await sleep(800);
log('规划提示:', await ev("document.getElementById('planHint').textContent"));
const knownIds = new Set((await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).map((t) => t.id));
await ev("document.getElementById('planBtn').click()");
let rep = null;
for (let i = 0; i < 12; i++) {
  await sleep(600);
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  rep = list.find((t) => t.type === 'page' && !knownIds.has(t.id));
  if (rep && rep.url && rep.url !== 'about:blank') break;
}
log('新标签页:', rep ? ('已打开 ' + rep.url.slice(0, 26) + '…') : '未打开');
log('聊天里报告卡:', await ev("!!document.querySelector('.plan-card')"));
log('报告卡标题:', await ev("(document.querySelector('.plan-t')||{}).textContent||'—'"));

/* 4. 检查报告内容（新标签页） */
if (rep) {
  const ws2 = new WebSocket(rep.webSocketDebuggerUrl);
  let id2 = 0; const pd2 = new Map();
  ws2.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pd2.has(m.id)) { const q = pd2.get(m.id); pd2.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } });
  await new Promise((r) => ws2.addEventListener('open', r));
  const s2 = (m, pr = {}) => { const i = ++id2; ws2.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd2.set(i, { res, rej })); };
  const e2 = async (x) => (await s2('Runtime.evaluate', { expression: x, returnByValue: true })).result.value;
  await s2('Runtime.enable').catch(() => { });
  await sleep(1200);
  log('报告标题:', await e2("document.querySelector('h1').textContent"));
  log('报告副标题:', await e2("document.querySelector('.sub').textContent"));
  log('排期行数:', await e2("document.querySelectorAll('table.plan tbody tr').length"));
  log('含 M84:', await e2("document.body.textContent.indexOf('M84')>0"));
  log('双路径:', await e2("document.querySelectorAll('.track').length"));
  log('提醒章节:', await e2("document.body.textContent.indexOf('6. 到期日提醒')>0"));
  log('提醒表行数:', await e2("document.querySelectorAll('#icsData').length ? document.querySelectorAll('table.small tbody tr').length : '—'"));
  log('日历按钮:', await e2("!!document.getElementById('icsBtn')"));
  log('ICS 长度:', await e2("((document.getElementById('icsData')||{}).value||'').length"));
  log('风险条数:', await e2("document.querySelectorAll('.risk').length"));
  log('强积金章节:', await e2("document.body.textContent.indexOf('强积金')>0"));
  log('收入估算行:', await e2("(document.body.textContent.match(/按你填的 HK\\$ [\\d,]+ \\/ 月估算/)||['—'])[0]"));
  log('免责声明:', await e2("document.body.textContent.indexOf('不构成')>0"));
  log('下载按钮:', await e2("!!document.getElementById('dlBtn')"));
  log('横向溢出:', await e2("document.documentElement.scrollWidth-document.documentElement.clientWidth"));
  ws2.close();
} else {
  log('未找到 blob 报告页');
}

/* 5. 下载（触发 Blob 下载，不检查文件内容） */
log('下载按钮存在:', await ev("!!document.querySelector('.plan-acts .btn.primary')"));

log('errs:', errs.length ? JSON.stringify(errs.slice(0, 5)) : 0);
await import('node:fs').then((fs) => fs.writeFileSync('_plan.txt', '\ufeff' + out.join('\n'), 'utf8'));
ws.close();
process.exit(0);

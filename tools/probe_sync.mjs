/* 多用户汇总 E2E：两个账号 → 各自的留资进汇总库 → 管理员登录后台看到 2 条 → 改阶段 → 导出
 * 用法：node tools/probe_sync.mjs [port] [base]
 */
const PORT = Number(process.argv[2] || 9241);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0) || l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const out = []; const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: true });
/* 把 8123 的 cookie 留在同一浏览器里，后台登录才生效 */
await send('Network.clearBrowserCookies');

/* 1. 账号 A */
await send('Page.navigate', { url: BASE + 'console.html' });
await sleep(3000);
await ev(`(async function(){
  try{ localStorage.clear(); }catch(e){}
  for (const n of ['alphapath','alphapath_leads']) {
    try{ await new Promise(function(r){var q=indexedDB.deleteDatabase(n);q.onsuccess=r;q.onerror=r;q.onblocked=r;}); }catch(e){}
  }
  return 1; })()`);
await send('Page.reload', { ignoreCache: true });
await sleep(3000);

async function makeUser(email, name, facts, turns) {
  return await ev(`(async function(){
    var db = AP.DB.get();
    var u = await db.auth.register(${JSON.stringify(email)}, 'passw0rd!', ${JSON.stringify(name)});
    var f = ${JSON.stringify(facts)};
    for (var k in f) { await db.profile.set(k, f[k], 'conversation'); }
    var now = Date.now(), msgs = [];
    for (var i=0;i<${turns};i++) msgs.push({ role: i%2?'assistant':'user', text:'第'+(i+1)+'轮', at: now - 3600000 + i*60000 });
    localStorage.setItem('ap:sessions:u:'+u.id, JSON.stringify([{ id:'s_'+u.id, title:'咨询', at: now-3600000, msgs: msgs }]));
    localStorage.setItem('ap:lead:consent:u:'+u.id, JSON.stringify({ contact:true, analytics:true, at:new Date().toISOString() }));
    return u.id;
  })()`);
}

const uidA = await makeUser('a@demo.hk', '陈先生', { identityType: 'TTPS_B', activationDate: '2025-09-01', dependants: 2, schoolStage: '中二', goal: 'pr' }, 10);
await send('Page.reload', { ignoreCache: true }); await sleep(2500);
await ev("document.getElementById('acctBtn').click()"); await sleep(300);
await ev("document.querySelector('.auth-tab[data-view=\"profile\"]').click()"); await sleep(1200);
log('A 留资状态:', await ev("document.getElementById('leadSync').textContent"));
await ev("(function(){var c=document.getElementById('leadAnalytics'); if(!c.checked){c.checked=true;c.dispatchEvent(new Event('change'));} return 1;})()");
await sleep(1500);
log('A 汇总结果:', await ev("document.getElementById('leadSync').textContent"));

/* 2. 账号 B（退出后另注册，模拟另一个用户） */
await ev(`(async function(){ var db=AP.DB.get(); if(db.auth.current()) await db.auth.logout(); return 1; })()`);
await sleep(600);
const uidB = await makeUser('b@demo.hk', '林女士', { identityType: 'QMAS', activationDate: '2026-01-15', dependants: 1, schoolStage: '小四', goal: 'school' }, 6);
await send('Page.reload', { ignoreCache: true }); await sleep(2500);
await ev("document.getElementById('acctBtn').click()"); await sleep(300);
await ev("document.querySelector('.auth-tab[data-view=\"profile\"]').click()"); await sleep(1000);
await ev("(function(){var c=document.getElementById('leadAnalytics'); if(!c.checked){c.checked=true;c.dispatchEvent(new Event('change'));} return 1;})()");
await sleep(1800);
log('B 汇总结果:', await ev("document.getElementById('leadSync').textContent"));
log('A/B uid:', uidA, uidB);

/* 3. 后台：未登录应被拦，登录后看到 2 条 */
await send('Page.navigate', { url: BASE + 'admin.html' });
await sleep(2200);
log('未登录显示登录框:', await ev("!document.getElementById('login').hidden"));
log('登录框遮住内容:', await ev("getComputedStyle(document.getElementById('login')).position"));
await ev("document.getElementById('lgPass').value='alphapath'; document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true})); 1");
await sleep(1800);
log('登录后隐藏登录框:', await ev("document.getElementById('login').hidden"));
log('模式标签:', await ev("document.getElementById('modeTag').textContent"));
log('表格行数:', await ev("document.querySelectorAll('#tbody tr').length"));
log('KPI:', await ev("Array.prototype.map.call(document.querySelectorAll('.kpi .v'),function(e){return e.textContent;}).join(' | ')"));

/* 4. 抽屉改阶段 → 服务端落库 */
await ev("document.querySelector('#tbody tr').click()"); await sleep(600);
log('抽屉标题:', await ev("document.querySelector('.dr-name').textContent"));
await ev("document.getElementById('drStage').value='contacted'; document.getElementById('drSave').click(); 1");
await sleep(1500);
const serverStages = await ev("(async function(){var r=await fetch('/_api/admin/leads?limit=50',{credentials:'same-origin'});var j=await r.json();return JSON.stringify(j.rows.map(function(x){return x.display_name+':'+x.stage+':'+x.intent_score;}));})()");
log('服务端线索:', serverStages);

/* 5. 导出 */
const csv = await ev("(async function(){var r=await fetch('/_api/admin/export.csv',{credentials:'same-origin'});var t=await r.text();return r.status+'|'+t.split('\\r\\n').length+'行|'+t.split('\\r\\n')[0].slice(1,40);})()");
log('CSV:', csv);

/* 6. 无 cookie 访问应 401 */
const unauth = await ev("(async function(){var r=await fetch('/_api/admin/leads',{credentials:'omit'});return r.status;})()");
log('未登录 API 状态码:', unauth);

log('errs:', errs.length ? JSON.stringify(errs.slice(0, 5)) : 0);
await import('node:fs').then((fs) => fs.writeFileSync('_sync.txt', '\ufeff' + out.join('\n'), 'utf8'));
ws.close();
process.exit(0);

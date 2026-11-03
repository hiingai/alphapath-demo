/* 测试账号 + 管理员登录 + 报告提醒章节 的端到端检查
 * 用法：node tools/probe_seed.mjs [port] [base]
 */
const PORT = Number(process.argv[2] || 9241);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const page = targets.find((t) => t.type === 'page') || targets[0];
const known = new Set(targets.map((t) => t.id));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pd = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) return 'EXC ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr).catch(() => false)) return true; await sleep(300); } return false; };
const log = (...a) => console.log(...a);

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: true });

/* 1. 种子导入 */
await send('Page.navigate', { url: BASE + 'console.html?seed=1' });
await waitFor('!!window.AP_BOOTED');
await sleep(1500);
log('本机账号数:', await ev("(async function(){var l=await AP.DB.get().adapter.all('users');return l.length;})()"));
log('账号邮箱:', await ev("(async function(){var l=await AP.DB.get().adapter.all('users');return l.map(function(u){return u.email;}).sort().join(',');})()"));

/* 2. 用种子账号登录（正确密码 / 错误密码） */
log('登录 user3 正确密码:', await ev("(async function(){try{var r=await AP.DB.get().auth.login('user3@alphapath.com','Hk123456');return 'OK '+r.email+' name='+r.name;}catch(e){return 'ERR '+e.message;}})()"));
log('登录 user3 错误密码:', await ev("(async function(){try{await AP.DB.get().auth.login('user3@alphapath.com','wrongpass1');return 'UNEXPECTED OK';}catch(e){return '按预期拒绝: '+e.message;}})()"));
log('登录 user10 大小写邮箱:', await ev("(async function(){try{var r=await AP.DB.get().auth.login('User10@AlphaPath.com','Hk123456');return 'OK '+r.email;}catch(e){return 'ERR '+e.message;}})()"));
log('已登录会话:', await ev("(function(){var s=AP.DB.get().auth.current();return s?('是 '+s.email):'否';})()"));

/* 3. 报告：提醒章节 + ICS */
log('页面内生成报告：提醒条数:', await ev("(function(){var p=AP.Plan.build({identityType:'TTPS_B',activationDate:'2025-09-01',employment:'employed',dependants:2,monthlyIncome:40000});window.__p=p;return p.reminders.length;})()"));
log('ICS 事件数:', await ev("(window.__p.ics.match(/BEGIN:VEVENT/g)||[]).length"));
log('ICS 最长行字节:', await ev("(function(){var t=window.__p.ics.split('\\r\\n');var m=0;t.forEach(function(l){var n=new TextEncoder().encode(l).length;if(n>m)m=n;});return m;})()"));
log('HTML 有提醒章节:', await ev("(AP.Plan.toHtml(window.__p).indexOf('6. 到期日提醒')>0)"));

/* 4. 后台管理员登录（本地 dev server 的 worker 实例） */
await send('Page.navigate', { url: BASE + 'admin.html' });
await sleep(2500);
const loginState = await ev("!!document.querySelector('#lgUser') && !document.getElementById('login').hidden");
log('出现登录框:', loginState);
if (loginState) {
  await ev("document.querySelector('#loginUser').value='admin1@alphapath.com'; document.querySelector('#lgPass').value='Hkadmin123456'; document.querySelector('#loginForm').requestSubmit(); 1");
  await sleep(2500);
  log('登录后标题:', await ev("(document.querySelector('.top h1')||document.querySelector('h1')||{}).textContent"));
  log('KPI/表格渲染:', await ev("document.querySelectorAll('tbody tr').length"));
}
log('errs:', errs.length ? JSON.stringify(errs.slice(0, 3)) : 0);
ws.close();
process.exit(0);

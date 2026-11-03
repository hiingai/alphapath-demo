/* 留资后台 E2E：真实浏览器里走「注册→对话留资→后台看板→详情→导出」
 * 用法：node tools/probe_admin.mjs [port] [base]
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

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: true });

/* 1. 控制台：注册 + 造一段对话历史 */
await send('Page.navigate', { url: BASE + 'console.html' });
await sleep(3500);
const seeded = await ev(`(async function(){
  try{ localStorage.clear(); }catch(e){}
  try{ await new Promise(function(r){var q=indexedDB.deleteDatabase('alphapath');q.onsuccess=r;q.onerror=r;q.onblocked=r;}); }catch(e){}
  try{ await new Promise(function(r){var q=indexedDB.deleteDatabase('alphapath_leads');q.onsuccess=r;q.onerror=r;q.onblocked=r;}); }catch(e){}
  return 1;
})()`);
await sleep(400);
await send('Page.reload', { ignoreCache: true });
await sleep(3500);
const uid = await ev(`(async function(){
  var db = AP.DB.get();
  var u = await db.auth.register('lead@demo.hk','passw0rd!','陈先生');
  var f = { identityType:'TTPS_B', activationDate:'2025-09-01', dependants:2, schoolStage:'中二', goal:'pr', employment:'employed' };
  for (var k in f) { await db.profile.set(k, f[k], 'conversation'); }
  var now = Date.now(), msgs = [];
  for (var i=0;i<10;i++){ msgs.push({ role: i%2 ? 'assistant':'user', text: '第'+(i+1)+'句', at: now - 86400000 + i*60000 }); }
  localStorage.setItem('ap:sessions:u:'+u.id, JSON.stringify([{ id:'s1', title:'高才B类咨询', at: now-86400000, msgs: msgs }]));
  return u.id;
})()`);
log('注册用户:', uid);
await send('Page.reload', { ignoreCache: true });
await sleep(3000);

/* 2. 打开「我的档案」看留资块 */
await ev("document.getElementById('acctBtn').click()");
await sleep(400);
await ev("document.querySelector('.auth-tab[data-view=\"profile\"]').click()");
await sleep(900);
log('留资阶段:', await ev("document.getElementById('leadStage').textContent"));
log('完整度:', await ev("document.getElementById('leadPctC').textContent"),
  '| 意向分:', await ev("document.getElementById('leadPctS').textContent"));
log('进度条宽度:', await ev("document.getElementById('leadBarC').style.width"), await ev("document.getElementById('leadBarS').style.width"));
const beforeConsent = await ev(`(async function(){
  var list = await AP.Lead.all(); var mine = list.filter(function(l){return l.ext_user_id==='${uid}';})[0];
  return { n: list.length, contact: mine && mine.contact_email, consent: mine && mine.consent_scope, stage: mine && mine.stage };
})()`);
log('未同意时线索:', JSON.stringify(beforeConsent));

/* 勾选同意 → 联系邮箱写入 */
await ev("var c=document.getElementById('leadConsent'); c.checked=true; c.dispatchEvent(new Event('change')); 1");
await sleep(800);
const afterConsent = await ev(`(async function(){
  var list = await AP.Lead.all(); var mine = list.filter(function(l){return l.ext_user_id==='${uid}';})[0];
  return { contact: mine && mine.contact_email, consent: mine && mine.consent_scope, score: mine && mine.intent_score };
})()`);
log('同意后线索:', JSON.stringify(afterConsent));
log('复选框已勾选:', await ev("document.getElementById('leadConsent').checked"));

/* 3. 后台（带演示数据） */
await send('Page.navigate', { url: BASE + 'admin.html?demo=1' });
await sleep(3000);
log('后台 KPI 卡数量:', await ev("document.querySelectorAll('.kpi').length"));
log('KPI 值:', await ev("Array.prototype.map.call(document.querySelectorAll('.kpi .v'),function(e){return e.textContent;}).join(' | ')"));
log('漏斗条数:', await ev("document.querySelectorAll('.fn').length"));
log('甜甜圈有渐变:', await ev("getComputedStyle(document.getElementById('donut')).backgroundImage.indexOf('conic-gradient')>=0"));
log('趋势 SVG 有点:', await ev("document.querySelectorAll('#trend .pt').length"));
log('表格行数:', await ev("document.querySelectorAll('#tbody tr').length"));
log('列表计数文案:', await ev("document.getElementById('leadCount').textContent"));
log('DEMO 横幅可见:', await ev("!document.getElementById('demoBanner').hidden"));
log('演示行带 DEMO 标:', await ev("document.querySelectorAll('#tbody .tag.demo').length"));

/* 筛选 */
await ev("document.getElementById('q').value='陈'; document.getElementById('q').dispatchEvent(new Event('input')); 1");
await sleep(300);
log('搜索「陈」后行数:', await ev("document.querySelectorAll('#tbody tr').length"));
await ev("document.getElementById('q').value=''; document.getElementById('q').dispatchEvent(new Event('input')); 1");
await sleep(300);

/* 4. 详情抽屉 */
await ev("document.querySelector('#tbody tr').click()");
await sleep(500);
log('抽屉打开:', await ev("!document.getElementById('drawer').hidden"));
log('抽屉标题:', await ev("document.querySelector('.dr-name').textContent"));
log('抽屉字段数:', await ev("document.querySelectorAll('.dr-f').length"));
log('时间线条数:', await ev("document.querySelectorAll('.tl li').length"));
log('抽屉有阶段选择:', await ev("!!document.getElementById('drStage')"));
/* 改阶段并保存 */
await ev("document.getElementById('drStage').value='contacted'; document.getElementById('drSave').click(); 1");
await sleep(900);
log('保存后抽屉关闭:', await ev("document.getElementById('drawer').hidden"));
log('已联系线索数:', await ev("(async function(){var a=await AP.Lead.all();return a.filter(function(l){return l.stage==='contacted';}).length;})()"));

/* 5. 布局与导出 */
log('横向溢出:', await ev("document.documentElement.scrollWidth - document.documentElement.clientWidth"));
log('CSV 头:', await ev("AP.Lead.toCsv([{display_name:'a',stage:'qualified'}]).split('\\r\\n')[0].slice(1,60)"));

/* 手机视图 */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(600);
log('手机横向溢出:', await ev("document.documentElement.scrollWidth - document.documentElement.clientWidth"));
log('手机 KPI 列数:', await ev("getComputedStyle(document.getElementById('kpis')).gridTemplateColumns.split(' ').length"));
await send('Emulation.clearDeviceMetricsOverride');

log('errs:', errs.length ? JSON.stringify(errs.slice(0, 4)) : 0);
await import('node:fs').then((fs) => fs.writeFileSync('_admin.txt', '\ufeff' + out.join('\n'), 'utf8'));
ws.close();
process.exit(0);

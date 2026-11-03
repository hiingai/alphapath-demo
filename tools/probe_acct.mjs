/* 账号系统 E2E：注册 → 档案学习 → 对话隔离 → 退出 → 再登录 */
const PORT = Number(process.argv[2] || 9241);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console: ' + m.params.args.map(a => a.value).join(' '));
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: BASE });
await sleep(BASE.indexOf('https://') === 0 ? 6500 : 4000);
/* 干净起点：清 localStorage + IndexedDB */
await ev("(async function(){try{localStorage.clear()}catch(e){};try{await new Promise(function(r){var q=indexedDB.deleteDatabase('alphapath');q.onsuccess=r;q.onerror=r;q.onblocked=r;});}catch(e){} return 1;})()");
await sleep(500);
await send('Page.reload', { ignoreCache: true });
await sleep(BASE.indexOf('https://') === 0 ? 7000 : 4500);

const out = []; const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

log('初始按钮:', String(await ev("document.getElementById('acctLabel').innerText")).trim());
log('模态默认隐藏:', await ev("document.getElementById('authModal').hidden"));
await ev("document.getElementById('acctBtn').click()");
await sleep(300);
log('打开后可见:', await ev("!document.getElementById('authModal').hidden"), '| 默认视图:', await ev("document.querySelector('.auth-tab.active').getAttribute('data-view')"));
log('手机/微信按钮 disabled:', await ev("document.getElementById('loginPhone').disabled"), await ev("document.getElementById('loginWeChat').disabled"));
log('即将开放标签:', String(await ev("document.querySelector('.soon').innerText")).trim());

/* 注册：先测校验错误 */
await ev(`(function(){document.querySelector('.auth-tab[data-view="register"]').click();return 1})()`);
await sleep(200);
await ev(`(function(){document.getElementById('regEmail').value='bad-email';document.getElementById('regPw').value='12345678';document.getElementById('regPw2').value='12345678';document.getElementById('doRegister').click();return 1})()`);
await sleep(500);
log('非法邮箱提示:', String(await ev("document.getElementById('authMsg').innerText")).trim());
await ev(`(function(){document.getElementById('regEmail').value='demo@alphapath.hk';document.getElementById('regPw').value='12345678';document.getElementById('regPw2').value='87654321';document.getElementById('doRegister').click();return 1})()`);
await sleep(400);
log('两次密码不一致提示:', String(await ev("document.getElementById('authMsg').innerText")).trim());

/* 正常注册 */
await ev(`(function(){document.getElementById('regName').value='陈先生';document.getElementById('regEmail').value='demo@alphapath.hk';document.getElementById('regPw').value='ap-demo-2026';document.getElementById('regPw2').value='ap-demo-2026';document.getElementById('doRegister').click();return 1})()`);
await sleep(2500);
log('注册后顶栏:', String(await ev("document.getElementById('acctLabel').innerText")).trim());
log('注册后模态关闭:', await ev("document.getElementById('authModal').hidden"));
log('已登录用户:', await ev("JSON.parse(localStorage.getItem('ap:auth:user')||'null') && JSON.parse(localStorage.getItem('ap:auth:user')).email"));
log('明文密码是否落库:', await ev(`(async function(){
  var db = await new Promise(function(r){var q=indexedDB.open('alphapath');q.onsuccess=function(){r(q.result)}});
  var users = await new Promise(function(r){var t=db.transaction('users','readonly').objectStore('users').getAll();t.onsuccess=function(){r(t.result)}});
  var u = users[0]||{};
  return JSON.stringify({n:users.length, hasPwText: JSON.stringify(u).indexOf('ap-demo-2026')>=0, algo:(u.pw||{}).algo, hashLen:((u.pw||{}).hash||'').length, saltLen:((u.pw||{}).salt||'').length});
})()`));

/* 对话触发档案学习 */
await ev(`(function(){document.getElementById('input').value='我是高才B类，2025-09-01 激活签证，带了 2 个孩子，老大读中二，主要想拿永居';document.getElementById('send').click();return 1})()`);
await sleep(BASE.indexOf('https://') === 0 ? 9000 : 5000);
log('对话轮数:', await ev("document.querySelectorAll('#chat .msg').length"));
await ev("document.getElementById('acctBtn').click()");
await sleep(600);
log('档案页标签可见:', await ev("!document.getElementById('authTabProfile').hidden"));
log('档案内容:', String(await ev("[...document.querySelectorAll('#profList .prof-row')].map(function(r){return r.querySelector('.prof-k').innerText+'='+r.querySelector('.prof-v').innerText}).join(' / ')")).trim());
log('登录态提示:', String(await ev("document.getElementById('profWho').innerText")).trim());

/* 会话命名空间：应写到 :u:<id> */
log('会话键:', await ev("Object.keys(localStorage).filter(function(k){return k.indexOf('ap:sessions')===0}).join(',')"));
const userIdx = await ev("Object.keys(localStorage).filter(function(k){return k.indexOf('ap:sessions:u:')===0})[0]");
log('用户会话条数:', await ev("JSON.parse(localStorage.getItem('" + userIdx + "')||'[]').length"));

await ev("document.getElementById('closeAuth').click()");
await sleep(200);

/* 退出登录 → 访客空间应看不到该对话 */
await ev("document.getElementById('acctBtn').click()");
await sleep(400);
await ev("document.getElementById('authTabProfile').click()");
await sleep(300);
await ev("document.getElementById('doLogout').click()");
await sleep(900);
log('退出后顶栏:', String(await ev("document.getElementById('acctLabel').innerText")).trim());
log('退出后会话条数(访客):', await ev("document.querySelectorAll('#sesList .ses-item').length"));
log('退出后聊天是否清空:', await ev("document.getElementById('chat').querySelector('.msg.welcome') !== null"));

/* 再登录 → 对话应回来 */
await ev("document.getElementById('acctBtn').click()");
await sleep(400);
await ev(`(function(){document.getElementById('loginEmail').value='demo@alphapath.hk';document.getElementById('loginPw').value='wrong-pass';document.getElementById('doLogin').click();return 1})()`);
await sleep(1200);
log('错密码提示:', String(await ev("document.getElementById('authMsg').innerText")).trim());
await ev(`(function(){document.getElementById('loginPw').value='ap-demo-2026';document.getElementById('doLogin').click();return 1})()`);
await sleep(2500);
log('重登后顶栏:', String(await ev("document.getElementById('acctLabel').innerText")).trim());
log('重登后会话条数:', await ev("document.querySelectorAll('#sesList .ses-item').length"));
log('重登后对话轮数:', await ev("document.querySelectorAll('#chat .msg').length"));

const fs = await import('node:fs');
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('shot_acct.png', Buffer.from(shot.data, 'base64'));
await ev("document.getElementById('acctBtn').click()");
await sleep(500);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('shot_acct_profile.png', Buffer.from(shot2.data, 'base64'));

/* 手机宽度检查 */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
log('手机模态宽度:', await ev("Math.round(document.querySelector('.modal-box.auth-box').getBoundingClientRect().width)"), '窗口宽 390');
log('手机纵向溢出:', await ev("(function(){var b=document.querySelector('.modal-box.auth-box').getBoundingClientRect();return Math.max(0, Math.round(b.bottom - window.innerHeight));})()"));
await send('Emulation.clearDeviceMetricsOverride');
log('errs:', errs.length, errs.slice(0, 3).join(' ; '));
fs.writeFileSync('_acct.txt', out.join('\n'), 'utf8');
ws.close();
process.exit(0);

/* 账号模态体检：布局 / 对比度 / 表单可用性（浅色+深色） */
const PORT = Number(process.argv[2] || 9241);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const THEME = process.argv[4] || 'light';
const FRESH = process.argv[5] === 'fresh';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails.text));
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await ev("try{localStorage.setItem('ap:theme','" + THEME + "')}catch(e){}1");
await send('Page.navigate', { url: BASE });
await sleep(BASE.indexOf('https://') === 0 ? 6500 : 4000);
if (FRESH) {
  await ev("(async function(){try{localStorage.clear()}catch(e){};try{await new Promise(function(r){var q=indexedDB.deleteDatabase('alphapath');q.onsuccess=r;q.onerror=r;q.onblocked=r;});}catch(e){} return 1;})()");
  await sleep(600);
  await send('Page.reload', { ignoreCache: true });
  await sleep(BASE.indexOf('https://') === 0 ? 7000 : 4500);
}

await ev("document.getElementById('acctBtn').click()");
await sleep(500);
const out = []; const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

log('主题:', await ev("document.documentElement.getAttribute('data-theme')"));
log('模态:', JSON.stringify(await ev(`(function(){var b=document.querySelector('.auth-box').getBoundingClientRect();
  return {w:Math.round(b.width),h:Math.round(b.height),topGap:Math.round(b.top),botGap:Math.round(window.innerHeight-b.bottom)};})()`)));
log('输入框是否密码型:', await ev("document.getElementById('loginPw').type"));
log('输入框高度:', await ev("Math.round(document.getElementById('loginEmail').getBoundingClientRect().height)"));
log('横向溢出元素:', await ev(`(function(){var box=document.querySelector('.auth-box').getBoundingClientRect();var bad=[];
  document.querySelectorAll('.auth-box *').forEach(function(el){var r=el.getBoundingClientRect();if(r.width&&(r.right>box.right+1||r.left<box.left-1))bad.push(el.className||el.tagName);});
  return bad.slice(0,5).join(',')||'无';})()`));
log('档案页默认隐藏:', await ev("document.getElementById('viewProfile').hidden"));
log('Enter 提交（表单可提交）:', await ev("document.getElementById('viewLogin').tagName === 'FORM' && !!document.getElementById('doLogin').type === true"));

const scan = await ev(`(function(){
  function lum(c){var m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;var a=m[1].split(',').map(parseFloat);
    if(a.length>3&&a[3]===0)return null;
    function f(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);}
    return .2126*f(a[0])+.7152*f(a[1])+.0722*f(a[2]);}
  function bgOf(el){var n=el;while(n&&n!==document.documentElement){var c=getComputedStyle(n).backgroundColor;var L=lum(c);if(L!==null)return{c:c,L:L};n=n.parentElement;}
    var c2=getComputedStyle(document.body).backgroundColor;return{c:c2,L:lum(c2)};}
  var bad=[],seen=0;
  document.querySelectorAll('.auth-box *').forEach(function(el){
    var has=false;for(var i=0;i<el.childNodes.length;i++){var n=el.childNodes[i];if(n.nodeType===3&&n.textContent.trim().length>1)has=true;}
    if(!has)return;var r=el.getBoundingClientRect();if(r.width<2)return;
    var st=getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden')return;seen++;
    var fg=lum(st.color);if(fg===null)return;var bg=bgOf(el);if(bg.L===null)return;
    var hi=Math.max(fg,bg.L),lo=Math.min(fg,bg.L),ratio=(hi+.05)/(lo+.05);
    if(ratio<3)bad.push({s:el.className,t:el.innerText.slice(0,14),r:Math.round(ratio*100)/100});
  });
  return {seen:seen,bad:bad.slice(0,8),n:bad.length};
})()`);
log('模态内低对比(浅/深):', scan.n, JSON.stringify(scan.bad));

/* 切到注册页，看表单高度是否撑出屏幕 */
await ev(`document.querySelector('.auth-tab[data-view="register"]').click()`);
await sleep(300);
log('注册页高度/是否溢出:', JSON.stringify(await ev(`(function(){var b=document.querySelector('.auth-box').getBoundingClientRect();
  return {h:Math.round(b.height), overflow:Math.max(0,Math.round(b.bottom-window.innerHeight))};})()`)));

const fs = await import('node:fs');
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('shot_acct_' + THEME + '.png', Buffer.from(shot.data, 'base64'));
log('errs:', errs.length);
fs.writeFileSync('_acctui_' + THEME + '.txt', out.join('\n'), 'utf8');
ws.close();
process.exit(0);

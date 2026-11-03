/* 对比度体检（含半透明背景合成）：node tools/probe_contrast.mjs <port> <url> <light|dark> [modal] */
const PORT = Number(process.argv[2] || 9241);
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const THEME = process.argv[4] || 'light';
const OPEN_MODAL = process.argv[5] === 'modal';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page' && t.url.indexOf('127.0.0.1') >= 0) || l.find((t) => t.type === 'page');
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
if (OPEN_MODAL) { await ev("document.getElementById('acctBtn').click()"); await sleep(500); }

const res = await ev(`(function(){
  function parse(c){
    var m = c.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    var a = m[1].split(',').map(function(x){return parseFloat(x);});
    return { r:a[0], g:a[1], b:a[2], a: a.length>3 ? a[3] : 1 };
  }
  function lum(rgb){
    function f(v){ v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); }
    return .2126*f(rgb.r) + .7152*f(rgb.g) + .0722*f(rgb.b);
  }
  /* 自底向上把半透明层叠到不透明白底上，得到真实背景色 */
  function realBg(el){
    var layers = [], n = el;
    while (n && n.nodeType === 1) {
      var c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      n = n.parentElement;
    }
    var base = { r:255, g:255, b:255, a:1 };
    for (var i = layers.length - 1; i >= 0; i--) {
      var t = layers[i];
      base = { r: t.r*t.a + base.r*(1-t.a), g: t.g*t.a + base.g*(1-t.a), b: t.b*t.a + base.b*(1-t.a), a: 1 };
    }
    return base;
  }
  var bad = [], seen = 0, scope = ${OPEN_MODAL} ? '.auth-box' : 'body';
  document.querySelectorAll(scope === 'body' ? 'body *' : '.auth-box *').forEach(function(el){
    var has = false;
    for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3 && n.textContent.trim().length > 1) has = true; }
    if (!has) return;
    var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) < 0.15) return;
    seen++;
    var fg = parse(st.color); if (!fg) return;
    var bg = realBg(el);   /* 从元素自身开始合成，否则会把按钮自己的底色漏掉 → 假阳性 */
    var fgL = lum(fg), bgL = lum(bg);
    var hi = Math.max(fgL, bgL), lo = Math.min(fgL, bgL);
    var ratio = (hi + .05) / (lo + .05);
    if (ratio < 3) bad.push({ sel: el.className || el.tagName, text: el.innerText.slice(0, 16), ratio: Math.round(ratio*100)/100, fg: st.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')' });
  });
  return { theme: document.documentElement.getAttribute('data-theme'), seen: seen, badCount: bad.length, bad: bad.slice(0, 12) };
})()`);

const tag = THEME + (OPEN_MODAL ? '/模态' : '/整页');
console.log(tag, '检查元素:', res.seen, '| 低对比(<3):', res.badCount);
res.bad.forEach((b) => console.log('  ' + b.ratio + '  ' + String(b.sel).slice(0, 24) + '  ' + JSON.stringify(b.text) + '  ' + b.fg + ' on ' + b.bg));
if (errs.length) console.log('errs:', errs.length, errs[0]);
ws.close();
process.exit(0);

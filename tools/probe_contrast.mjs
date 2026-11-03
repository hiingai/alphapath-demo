/* 浅色主题可读性体检：扫描可见文字元素的前景/背景对比度 */
const PORT = Number(process.argv[2] || 9234);
const THEME = process.argv[4] || 'dark';
const BASE = process.argv[3] || 'http://127.0.0.1:8123/console.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
const p = l.find((t) => t.type === 'page');
const ws = new WebSocket(p.webSocketDebuggerUrl);
let id = 0; const pd = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pd.has(m.id)) { const q = pd.get(m.id); pd.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
});
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
const send = (m, pr = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: pr })); return new Promise((res, rej) => pd.set(i, { res, rej })); };
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await ev("try{localStorage.setItem('ap:theme','" + THEME + "');localStorage.setItem('ap:fish',JSON.stringify({identityType:'TTPS_B',activationDate:'2025-09-01',applyDate:'2025-04-15'}));localStorage.setItem('ap:fish:open2','1');}catch(e){}1");
await send('Page.navigate', { url: BASE });
await sleep(BASE.indexOf('https://') === 0 ? 6500 : 4000);

const res = await ev(`(function(){
  function lum(c){
    var m = c.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    var a = m[1].split(',').map(function(x){return parseFloat(x);});
    if (a.length > 3 && a[3] === 0) return null;
    function f(v){ v/=255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); }
    return .2126*f(a[0]) + .7152*f(a[1]) + .0722*f(a[2]);
  }
  function bgOf(el){
    var n = el;
    while (n && n !== document.documentElement) {
      var c = getComputedStyle(n).backgroundColor;
      var L = lum(c);
      if (L !== null) return { c: c, L: L };
      n = n.parentElement;
    }
    return { c: getComputedStyle(document.body).backgroundColor, L: lum(getComputedStyle(document.body).backgroundColor) };
  }
  var bad = [], seen = 0;
  document.querySelectorAll('body *').forEach(function(el){
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim().length > 1) hasText = true;
    }
    if (!hasText) return;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    var st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || parseFloat(st.opacity) < 0.15) return;
    seen++;
    var fg = lum(st.color); if (fg === null) return;
    var bg = bgOf(el); if (bg.L === null) return;
    var hi = Math.max(fg, bg.L), lo = Math.min(fg, bg.L);
    var ratio = (hi + .05) / (lo + .05);
    if (ratio < 3) bad.push({ sel: el.className || el.tagName, text: el.innerText.slice(0, 18), ratio: Math.round(ratio*100)/100, fg: st.color, bg: bg.c });
  });
  return { seen: seen, bad: bad.slice(0, 14), badCount: bad.length };
})()`);

console.log('检查元素:', res.seen, '| 低对比(<3):', res.badCount);
res.bad.forEach((b) => console.log('  ' + (b.ratio) + '  ' + String(b.sel).slice(0, 26) + '  ' + JSON.stringify(b.text) + '  ' + b.fg + ' on ' + b.bg));
const fs = await import('node:fs');
fs.writeFileSync('_contrast.txt', JSON.stringify(res, null, 1), 'utf8');
ws.close();
process.exit(0);

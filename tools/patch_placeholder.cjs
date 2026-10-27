const fs = require('fs');

// 1) console.html 输入框 placeholder
let s = fs.readFileSync('console.html', 'utf8');
const oldP = '说说你的情况，例如：外佣能不能拿永居？（Enter 发送 / Shift+Enter 换行）';
const newP = '说说你的情况，例如：我是高才B类，2025.2.1激活签证，什么时候能拿永居？（Enter 发送 / Shift+Enter 换行）';
if (s.indexOf(oldP) >= 0) {
  s = s.split(oldP).join(newP);
  fs.writeFileSync('console.html', s, 'utf8');
  console.log('placeholder: replaced');
} else {
  console.log('placeholder: not found');
}

// 2) app.js 示例列表：把高才B 的时间线问法放第一条
let a = fs.readFileSync('app.js', 'utf8');
const anchor = '  var EXAMPLES = [\n';
const first = "    '我是高才B类，2025.2.1激活签证，什么时候能拿永居？',\n";
if (a.indexOf(first) >= 0) {
  console.log('example: already there');
} else if (a.indexOf(anchor) >= 0) {
  a = a.replace(anchor, anchor + first);
  fs.writeFileSync('app.js', a, 'utf8');
  console.log('example: prepended');
} else {
  console.log('example: anchor not found');
}

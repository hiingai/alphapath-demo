const fs = require('fs');
const V = process.argv[2] || '20261027b';
let s = fs.readFileSync('console.html', 'utf8');
const before = s;
// 给静态资源加版本号，避免 GitHub Pages 的 10 分钟缓存让用户跑到旧 JS
s = s.replace(/href="style\.css"/g, 'href="style.css?v=' + V + '"');
s = s.replace(/src="app\.js"/g, 'src="app.js?v=' + V + '"');
s = s.replace(/src="(engine\/[^"]+\.js)"/g, 'src="$1?v=' + V + '"');
fs.writeFileSync('console.html', s, 'utf8');
console.log('changed:', before !== s);
const hits = s.match(/\?v=20261027b/g) || [];
console.log('tagged tags:', hits.length);

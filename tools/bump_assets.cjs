const fs = require('fs');
const V = process.argv[2] || '20261027c';
let s = fs.readFileSync('console.html', 'utf8');
const before = s;
s = s.replace(/href="(style\.css)(\?v=[^"]*)?"/g, 'href="$1?v=' + V + '"');
s = s.replace(/src="(app\.js)(\?v=[^"]*)?"/g, 'src="$1?v=' + V + '"');
s = s.replace(/src="(engine\/[^"?]+\.js)(\?v=[^"]*)?"/g, 'src="$1?v=' + V + '"');
fs.writeFileSync('console.html', s, 'utf8');
console.log('changed:', before !== s, '| tags:', (s.match(new RegExp('\\?v=' + V, 'g')) || []).length);

/* 本地开发服务器：静态站 + 与线上完全相同的 /_api（node:sqlite 冒充 D1）
 * 用法：node tools/dev_server.mjs [port]      默认 8123
 * 目的：在没有 Cloudflare 账号前，也能真实演示"多用户汇总 + 管理后台"。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../worker/app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8123);
const DB_FILE = path.join(ROOT, '.data', 'alphapath.db');
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const sqlite = new DatabaseSync(DB_FILE);
sqlite.exec(fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8'));

class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a); }
  async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; }
  async run() { const r = sqlite.prepare(this.sql).run(...this.args); return { success: true, meta: r }; }
}
const env = {
  DB: { prepare: (sql) => new Stmt(sql) },
  ADMIN_USER: process.env.ADMIN_USER || 'admin1@alphapath.com',
  ADMIN_PASS: process.env.ADMIN_PASS || 'Hkadmin123456',
  ADMIN_SECRET: process.env.ADMIN_SECRET || 'dev-secret',
  BUILD: 'dev'
};

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript;charset=utf-8', '.mjs': 'text/javascript;charset=utf-8', '.css': 'text/css;charset=utf-8', '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/markdown;charset=utf-8', '.txt': 'text/plain;charset=utf-8', '.sql': 'text/plain;charset=utf-8', '.woff2': 'font/woff2' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/_api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request('http://127.0.0.1' + req.url, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
    });
    const out = await handle(request, env);
    const headers = {};
    out.headers.forEach((v, k) => (headers[k] = v));
    res.writeHead(out.status, headers);
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }

  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain;charset=utf-8' });
    res.end('404');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log('AlphaPath dev server → http://127.0.0.1:' + PORT + '  (db: .data/alphapath.db)');
  console.log('后台: http://127.0.0.1:' + PORT + '/admin.html   管理员: ' + env.ADMIN_USER + ' / ' + env.ADMIN_PASS);
});

/* 用 node:sqlite 冒充 D1，让 worker 代码在 Node 里原样跑（测试 / 本地 dev 共用） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.db, this.sql, a); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: r }; }
}

export function makeEnv(extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8'));
  return {
    DB: { prepare: (sql) => new Stmt(db, sql), _raw: db },
    ADMIN_USER: 'admin',
    ADMIN_PASS: 'alphapath',
    ADMIN_SECRET: 'test-secret',
    BUILD: 'test',
    ...extra
  };
}

export function cookieOf(res) {
  const raw = res.headers.get('set-cookie') || '';
  const m = raw.match(/ap_admin=[^;]+/);
  return m ? m[0] : '';
}

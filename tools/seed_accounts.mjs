/* 生成测试账号种子（与 engine/userdb.js 的 PBKDF2-SHA256 参数完全一致）
 * 用法：node tools/seed_accounts.mjs [--check]
 * 输出：accounts.seed.json（只存摘要，不含明文密码）
 * 校验：--check 会用明文密码重新派生，确认与写入的摘要一致
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const ITER = 120000, KEYLEN = 32; // 与 userdb.js 的 PBKDF2_ITER / deriveBits(256) 对齐
const USERS = Array.from({ length: 10 }, (_, i) => ({
  email: `user${i + 1}@alphapath.com`,
  password: 'Hk123456',
  name: `测试用户 ${i + 1}`,
  tag: `u${i + 1}`
}));
const ADMINS = [{ email: 'admin1@alphapath.com', password: 'Hkadmin123456', name: '测试管理员' }];

const derive = (pw, saltHex, iter = ITER) =>
  crypto.pbkdf2Sync(Buffer.from(String(pw), 'utf8'), Buffer.from(saltHex, 'hex'), iter, KEYLEN, 'sha256').toString('hex');

function makeUser(spec, idx) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: 'usr_seed_' + spec.tag,
    email: spec.email,
    emailLower: spec.email.toLowerCase(),
    name: spec.name,
    pw: { algo: 'PBKDF2-SHA256', iter: ITER, salt, hash: derive(spec.password, salt) },
    providers: { phone: null, wechat: null },
    seeded: true,
    createdAt: new Date(Date.UTC(2026, 9, 31, 0, idx)).toISOString()
  };
}

const accounts = USERS.map(makeUser);

if (process.argv.includes('--check')) {
  const file = JSON.parse(fs.readFileSync('accounts.seed.json', 'utf8'));
  let bad = 0;
  for (const spec of USERS) {
    const a = file.users.find((u) => u.emailLower === spec.email);
    if (!a) { console.log('缺失:', spec.email); bad++; continue; }
    if (derive(spec.password, a.pw.salt, a.pw.iter) !== a.pw.hash) { console.log('摘要不匹配:', spec.email); bad++; }
  }
  console.log(bad ? `校验失败 ${bad} 个` : `校验通过 ${USERS.length} / ${USERS.length}`);
  process.exit(bad ? 1 : 0);
}

const out = {
  note: '测试账号种子：仅本地演示用。用户密码统一 Hk123456；管理员密码见 docs/测试账号-说明.md。文件里只有 PBKDF2 摘要，没有明文密码。',
  build: JSON.parse(fs.readFileSync('version.json', 'utf8')).build,
  generatedAt: new Date().toISOString(),
  algo: { name: 'PBKDF2-SHA256', iter: ITER, bits: KEYLEN * 8 },
  users: accounts,
  adminsNote: '管理员不走前端账号库，由 Worker 环境变量 ADMIN_USER / ADMIN_PASS 校验：admin1@alphapath.com / Hkadmin123456（生产用 wrangler secret put 设置）'
};
fs.writeFileSync('accounts.seed.json', JSON.stringify(out, null, 2) + '\n');
console.log('写入 accounts.seed.json：', accounts.length, '个用户；示例 id', accounts[0].id);
console.log('邮箱：', accounts.map((a) => a.email).join(', '));

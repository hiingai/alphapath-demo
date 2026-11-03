/* 用户库（IndexedDB/内存适配器 + 邮箱认证 + 档案事实）单元测试
 * 浏览器里走 IndexedDB + PBKDF2；Node 里用内存适配器 + SHA-256 降级实现验证同一套逻辑。
 */
import { loadEngine } from './engine_loader.mjs';

const { AP } = loadEngine();
let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; failures.push(name + (got !== undefined ? ' → ' + got : '')); } };

const db = AP.DB.create({ adapter: AP.DB.memoryAdapter() });

/* 注册 / 登录 */
const u = await db.auth.register('Alex@Example.com ', 'passw0rd!', 'Alex');
ok('注册：邮箱归一化小写', u.email === 'alex@example.com', u.email);
ok('注册：默认昵称取邮箱前缀', u.name === 'Alex', u.name);
ok('注册：预留手机/微信 provider 为空', u.providers && u.providers.phone === null && u.providers.wechat === null);
const rows = await db.adapter.all('users');
ok('存储：不落明文密码', JSON.stringify(rows[0].pw).indexOf('passw0rd') < 0);
ok('存储：密码带盐', typeof rows[0].pw.salt === 'string' && rows[0].pw.salt.length >= 16, rows[0].pw.algo);
ok('存储：算法标记 PBKDF2', rows[0].pw.algo === 'PBKDF2-SHA256', rows[0].pw.algo);
ok('注册：重复邮箱被拒', await db.auth.register('ALEX@example.com', 'another123').then(() => false).catch(() => true));
ok('注册：弱密码被拒', await db.auth.register('b@e.com', '123').then(() => false).catch(() => true));
ok('注册：非法邮箱被拒', await db.auth.register('nope', 'passw0rd!').then(() => false).catch(() => true));

ok('登录：正确密码成功', (await db.auth.login('alex@example.com', 'passw0rd!')).email === 'alex@example.com');
ok('登录：错误密码失败', await db.auth.login('alex@example.com', 'wrongpass').then(() => false).catch(() => true));
ok('登录：错密码不会因长度相同而误放行', await db.auth.login('alex@example.com', 'an0ther!!').then(() => false).catch(() => true));

/* 预留通道 */
const phoneErr = await db.auth.loginWithPhone('13800000000', '1234').then(() => null).catch((e) => e);
ok('预留：手机登录返回 NOT_ENABLED', phoneErr && phoneErr.code === 'NOT_ENABLED', phoneErr && phoneErr.code);
const wxErr = await db.auth.loginWithWeChat({ code: 'x' }).then(() => null).catch((e) => e);
ok('预留：微信登录返回 NOT_ENABLED', wxErr && wxErr.code === 'NOT_ENABLED');
const modes = db.auth.loginModes();
ok('预留：登录方式清单三通道（仅邮箱 enabled）',
  modes.length === 3 && modes.filter((m) => m.enabled).map((m) => m.id).join(',') === 'email',
  modes.map((m) => m.id + ':' + m.enabled).join(','));

/* 档案学习 */
await db.profile.learn('我是高才B类，2025.9.1 激活签证，家里两个孩子要插班中二，想查永居进度');
const f1 = await db.profile.get();
ok('档案：抽到身份 B', f1.identityType === 'TTPS_B', f1.identityType);
ok('档案：抽到激活日', f1.activationDate === '2025-09-01', f1.activationDate);
ok('档案：抽到受养人数量（中文数字）', f1.dependants === 2, String(f1.dependants));
ok('档案：抽到学段', f1.schoolStage === '中二', f1.schoolStage);
ok('档案：抽到主要诉求', f1.goal === 'pr', f1.goal);

await db.profile.learn('我其实是高才A类，2025年9月1日激活');
const f2 = await db.profile.get();
ok('改口：以最新说法为准（B → A）', f2.identityType === 'TTPS_A', f2.identityType);
const idFacts = (await db.adapter.all('facts')).filter((x) => x.key === 'identityType');
ok('改口：旧值进 history', idFacts.some((x) => (x.history || []).some((h) => h.value === 'TTPS_B')));

const rebuilt = await db.profile.rebuild(
  [{ msgs: [{ role: 'user', text: '我是优才，2024.3.1 激活' }, { role: 'assistant', text: '好' }] }],
  [{ content: '她有一个孩子，读小学五年级' }]
);
ok('重建：从对话+记忆批量学习', rebuilt.identityType === 'QMAS' && rebuilt.activationDate === '2024-03-01', JSON.stringify(rebuilt));
const ctx = await db.profile.asContext();
ok('上下文：身份被翻译成人话', ctx.indexOf('优才') >= 0, ctx.split('\n')[0]);
ok('上下文：带「可能过时」提醒', ctx.indexOf('可能过时') >= 0);

await db.profile.set('activationDate', '');
ok('清空：单项事实可清', !(await db.profile.get()).activationDate);

console.log('\n===== 用户库断言 =====');
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.log('失败项：'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通过 ✅');

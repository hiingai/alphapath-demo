/* 汇总 API 测试：直接调 worker/app.mjs 的 handle()，DB 用 node:sqlite 冒充 D1 */
import { handle, scoreOf, completenessOf, stageOf } from '../worker/app.mjs';
import { makeEnv, cookieOf } from './d1_shim.mjs';

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; failures.push(name + (got !== undefined ? ' → ' + JSON.stringify(got) : '')); } };

const env = makeEnv();
const call = async (path, opts = {}) => {
  const req = new Request('https://api.test' + path, opts);
  const res = await handle(req, env);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, body, headers: res.headers };
};

const TOKEN = 'u-testtoken-1234567890';
const evOf = (leadId, payload, id) => ({ event_id: id || leadId + '@v1', type: 'lead.upsert', occurred_at: new Date().toISOString(), payload: Object.assign({ lead_id: leadId }, payload) });
const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

/* ---- 规则镜像 ---- */
ok('规则：评分与引擎一致（满分 100）', scoreOf({ identity_type: 'TTPS_B', activation_date: '2025-09-01', dependants: 2, school_stage: '中二', goal: 'pr' }, { turns: 10, sessions: 2, email: 'x', consent: true }).intent === 100);
ok('规则：完整度 4 项', completenessOf({ identity_type: 'A', activation_date: 'B', dependants: 1, goal: 'pr' }) === 100);
ok('规则：人工阶段不回退', stageOf({ email_hash: 'x', identity_type: 'TTPS_B', activation_date: '2025-09-01', intent_score: 90 }, 'contacted') === 'contacted');

/* ---- 健康检查 ---- */
const h = await call('/_api/health');
ok('health 200 且带 db', h.status === 200 && h.body.ok && h.body.db === true);

/* ---- ingest 校验 ---- */
ok('短 token 被拒', (await post('/_api/ingest', { token: 'bad', events: [] })).status === 400);
ok('空事件可接受', (await post('/_api/ingest', { token: TOKEN, events: [] })).body.accepted === 0);
ok('非法 lead_id 被跳过', (await post('/_api/ingest', { token: TOKEN, events: [evOf('hack', {})] })).body.skipped === 1);
const tooBig = await post('/_api/ingest', { token: TOKEN, events: [evOf('ld_00000001', { summary: 'x'.repeat(70000) })] });
ok('超大 body 被拒', tooBig.status === 413, tooBig.status);

/* ---- 写入 + 幂等 + 服务端重算 ---- */
const lead = {
  lead_id: 'ld_11112222', display_name: '陈先生', email_hash: '11112222',
  identity_type: 'TTPS_B', activation_date: '2025-09-01', dependants: 2, school_stage: '中二', goal: 'pr',
  consent_at: '2026-10-30T00:00:00Z', consent_scope: 'both', contact_email: 'a@demo.hk',
  n_sessions: 2, n_turns: 10, n_days: 3, summary: '身份明确；有 2 名受养人（中二）；诉求拿永居',
  facts: [{ key: 'identityType', label: '身份类型', value: 'TTPS_B', evidence: '我是高才B类', updated_at: '2026-10-30T00:00:00Z' }],
  intent_score: 999, completeness: 0, stage: 'visitor'      /* 故意乱填，服务端必须自己算 */
};
const r1 = await post('/_api/ingest', { token: TOKEN, events: [evOf('ld_11112222', lead)] });
ok('写入成功', r1.body.accepted === 1, r1.body);
const row = env.DB._raw.prepare('SELECT * FROM leads WHERE lead_id = ?').get('ld_11112222');
ok('服务端重算分数（忽略客户端 999）', row.intent_score === 100, row.intent_score);
ok('服务端重算完整度', row.completeness === 100, row.completeness);
ok('阶段自动判为合格', row.stage === 'qualified', row.stage);
ok('同意后保留联系方式', row.contact_email === 'a@demo.hk');

const r2 = await post('/_api/ingest', { token: TOKEN, events: [evOf('ld_11112222', lead)] });
ok('重复 event_id 幂等', r2.body.accepted === 0 && r2.body.skipped === 1, r2.body);
ok('幂等不会产生第二行', env.DB._raw.prepare('SELECT COUNT(*) c FROM leads').get().c === 1);

/* ---- 未同意：联系方式必须丢 ---- */
await post('/_api/ingest', {
  token: TOKEN,
  events: [evOf('ld_33334444', { display_name: '林女士', email_hash: '33334444', contact_email: 'b@demo.hk', identity_type: 'QMAS', goal: 'school' }, 'ld_33334444@v1')]
});
const row2 = env.DB._raw.prepare('SELECT * FROM leads WHERE lead_id = ?').get('ld_33334444');
ok('未同意时联系方式被丢弃', row2.contact_email === null);
ok('未同意时阶段=已注册', row2.stage === 'registered', row2.stage);

/* ---- 管理端鉴权 ---- */
ok('未登录读线索 401', (await call('/_api/admin/leads')).status === 401);
ok('密码错误 401', (await post('/_api/admin/login', { user: 'admin', pass: 'nope' })).status === 401);
const lg = await post('/_api/admin/login', { user: 'admin', pass: 'alphapath' });
const ck = cookieOf(lg);
ok('登录成功并下发 HttpOnly Cookie', lg.status === 200 && /ap_admin=/.test(ck) && /HttpOnly/i.test(lg.headers.get('set-cookie')), ck.slice(0, 16));
const auth = { cookie: ck };

/* ---- 概览 / 列表 / 筛选 ---- */
const ov = await call('/_api/admin/overview', { headers: auth });
ok('概览 2 条线索', ov.body.n === 2, ov.body.n);
ok('概览漏斗含各阶段计数', ov.body.byStage.qualified === 1 && ov.body.byStage.registered === 1, ov.body.byStage);
ok('概览含身份分布', ov.body.byIdentity.TTPS_B === 1, ov.body.byIdentity);
const ls = await call('/_api/admin/leads', { headers: auth });
ok('列表返回 2 行', ls.body.rows.length === 2);
ok('列表行带 facts 数组', Array.isArray(ls.body.rows[0].facts));
const fq = await call('/_api/admin/leads?q=' + encodeURIComponent('陈'), { headers: auth });
ok('按称呼搜索', fq.body.rows.length === 1 && fq.body.rows[0].display_name === '陈先生');
const fs2 = await call('/_api/admin/leads?stage=registered', { headers: auth });
ok('按阶段筛选', fs2.body.rows.length === 1 && fs2.body.rows[0].lead_id === 'ld_33334444');

/* ---- 详情 / 改阶段 / 备注 / 审计 ---- */
const dt = await call('/_api/admin/leads/ld_11112222', { headers: auth });
ok('详情含事件流', dt.body.lead.display_name === '陈先生' && dt.body.events.length >= 1);
const pt = await call('/_api/admin/leads/ld_11112222', { method: 'PATCH', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ stage: 'contacted', note: '已电话沟通' }) });
ok('改阶段成功', pt.status === 200);
const after = env.DB._raw.prepare('SELECT stage,note FROM leads WHERE lead_id = ?').get('ld_11112222');
ok('阶段与备注落库', after.stage === 'contacted' && after.note === '已电话沟通');
ok('审计日志有记录', env.DB._raw.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='lead.update'").get().c === 1);
ok('非法阶段被拒', (await call('/_api/admin/leads/ld_11112222', { method: 'PATCH', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify({ stage: 'hacked' }) })).status === 400);

/* 再上报一次旧数据：人工阶段不能被回退 */
await post('/_api/ingest', { token: TOKEN, events: [evOf('ld_11112222', lead, 'ld_11112222@v2')] });
ok('重新上报不会把已联系退回合格', env.DB._raw.prepare('SELECT stage FROM leads WHERE lead_id = ?').get('ld_11112222').stage === 'contacted');

/* ---- 导出 ---- */
const ex = await call('/_api/admin/export.csv', { headers: auth });
const exRaw = await handle(new Request('https://api.test/_api/admin/export.csv', { headers: auth }), env);
const exBytes = new Uint8Array(await exRaw.arrayBuffer());
ok('CSV 带 BOM', exBytes[0] === 0xef && exBytes[1] === 0xbb && exBytes[2] === 0xbf, [...exBytes.slice(0, 3)]);
ok('CSV 表头中文', ex.body.indexOf('意向分') > 0 && ex.body.indexOf('阶段') > 0);
ok('CSV 只含未删除 2 行', ex.body.trim().split('\r\n').length === 3, ex.body.split('\r\n').length);

/* ---- 删除：用户自助 + 管理员 ---- */
const wrong = await post('/_api/lead-delete', { token: 'u-someoneelse-000000', lead_id: 'ld_33334444' });
ok('用户删除：token 不符 403', wrong.status === 403, wrong.status);
const selfDel = await post('/_api/lead-delete', { token: TOKEN, lead_id: 'ld_33334444' });
ok('用户删除：本人成功', selfDel.body.deleted === 1);
const gone = env.DB._raw.prepare('SELECT deleted_at,contact_email,email_hash FROM leads WHERE lead_id = ?').get('ld_33334444');
ok('删除后清空联系方式并留时间戳', gone.deleted_at && gone.contact_email === null && gone.email_hash === null);
ok('删除后列表不可见', (await call('/_api/admin/leads', { headers: auth })).body.rows.length === 1);
const ad = await post('/_api/admin/leads/ld_11112222/delete', {}, auth);
ok('管理员删除成功', ad.body.ok === true);
ok('管理员删除写审计', ad.body.ok === true && env.DB._raw.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='lead.delete'").get().c === 2);

console.log(`\n通过 ${pass} / ${pass + fail}`);
if (fail) { console.log('失败：'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通过 ✅');

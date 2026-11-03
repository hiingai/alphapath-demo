/* 留资（lead）单元测试：评分 / 完整度 / 阶段 / 归并 / 聚合 / 导出
 * 纯函数用 _pure 直接测；存储用无 IDB 的 Node 环境（自动退内存）。
 */
import { loadEngine } from './engine_loader.mjs';

const { AP } = loadEngine();
let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; failures.push(name + (got !== undefined ? ' → ' + got : '')); } };

const P = AP.Lead._pure;

/* ---- 评分 ---- */
const fullFacts = { identityType: 'TTPS_B', activationDate: '2025-09-01', dependants: 2, schoolStage: '中二', goal: 'pr', employment: 'employed' };
const s1 = P.score(fullFacts, { turns: 10, sessions: 2, email: 'a@b.com', consent: true });
ok('评分：字段齐全 + 互动深 + 可联系 = 100', s1.intent === 100, s1.intent);
ok('评分：分项合计等于总分', Object.values(s1.parts).reduce((a, b) => a + b, 0) === s1.intent);
ok('评分：全空 = 0', P.score({}, {}).intent === 0);
ok('评分：具体类别 20 分', P.score({ identityType: 'TTPS_A' }, {}).parts.identity === 20);
ok('评分：笼统身份只给 10 分', P.score({ identityType: 'QMAS' }, {}).parts.identity === 10);
ok('评分：有受养人无学段 = 8 分', P.score({ dependants: 2 }, {}).parts.family === 8);
ok('评分：有受养人有学段 = 15 分', P.score({ dependants: 2, schoolStage: '小四' }, {}).parts.family === 15);
ok('评分：诉求=永居 20 分', P.score({ goal: 'pr' }, {}).parts.goal === 20);
ok('评分：诉求=择校 10 分', P.score({ goal: 'school' }, {}).parts.goal === 10);
ok('评分：1 轮 4 分 / 8 轮未跨会话 9 分',
  P.score({}, { turns: 1 }).parts.engage === 4 && P.score({}, { turns: 8, sessions: 1 }).parts.engage === 9,
  P.score({}, { turns: 8, sessions: 1 }).parts.engage);
ok('评分：有邮箱未同意联系 6 分，同意后 15 分',
  P.score({}, { email: 'a@b.com' }).parts.contact === 6 && P.score({}, { email: 'a@b.com', consent: true }).parts.contact === 15);

/* ---- 完整度 ---- */
ok('完整度：4/4 = 100', P.completeness(fullFacts) === 100);
ok('完整度：2/4 = 50', P.completeness({ identityType: 'TTPS_B', goal: 'pr' }) === 50);
ok('完整度：空 = 0', P.completeness({}) === 0);

/* ---- 阶段 ---- */
ok('阶段：无邮箱无账号 = 访客', P.stageOf({ email_hash: '', ext_user_id: '' }, null) === 'visitor');
ok('阶段：有邮箱无身份 = 已注册', P.stageOf({ email_hash: 'x', ext_user_id: 'u', identity_type: null, activation_date: null }, null) === 'registered');
ok('阶段：身份+日期齐且分数够 = 合格', P.stageOf({ email_hash: 'x', identity_type: 'TTPS_B', activation_date: '2025-09-01', intent_score: 55 }, null) === 'qualified');
ok('阶段：身份日期齐但分数不够 = 已注册', P.stageOf({ email_hash: 'x', identity_type: 'TTPS_B', activation_date: '2025-09-01', intent_score: 30 }, null) === 'registered');
ok('阶段：人工「已联系」不被自动回退', P.stageOf({ email_hash: 'x', identity_type: 'TTPS_B', activation_date: '2025-09-01', intent_score: 80 }, 'contacted') === 'contacted');
ok('阶段：人工「已流失」保持', P.stageOf({ email_hash: '', ext_user_id: '' }, 'lost') === 'lost');

/* ---- buildLead ---- */
const user = { id: 'usr_test', email: 'Alex@Example.com', name: 'Alex' };
const lead1 = P.buildLead({ user, facts: fullFacts, meta: { turns: 10, sessions: 2, days: 3 } });
ok('线索：未同意联系时不写入邮箱', lead1.contact_email === null);
ok('线索：只存邮箱短指纹（不含明文）', lead1.email_hash.length === 8 && JSON.stringify(lead1).indexOf('alex@example.com') < 0, lead1.email_hash);
ok('线索：字段映射正确', lead1.identity_type === 'TTPS_B' && lead1.activation_date === '2025-09-01' && lead1.dependants === 2 && lead1.goal === 'pr');
ok('线索：完整度与评分已算好', lead1.completeness === 100 && lead1.intent_score > 0, lead1.intent_score);
ok('线索：同邮箱 id 稳定', P.buildLead({ user, facts: {} }).id === lead1.id);
ok('线索：不同邮箱 id 不同', P.buildLead({ user: { id: 'u2', email: 'b@e.com' }, facts: {} }).id !== lead1.id);
ok('线索：事实行带 label', lead1.facts.some((f) => f.key === 'identityType' && f.label === '身份类型'));

const lead2 = P.buildLead({ user, facts: fullFacts, meta: { turns: 10, sessions: 2 }, consent: { contact: true, analytics: true, at: '2026-10-30T00:00:00Z' } });
ok('线索：同意后写入邮箱与 scope', lead2.contact_email === 'alex@example.com' && lead2.consent_scope === 'both');
ok('线索：同意后评分升至满分', lead2.intent_score === 100, lead2.intent_score);

/* ---- 会话统计 ---- */
const sessions = [
  { id: 's1', at: Date.parse('2026-10-28T10:00:00Z'), msgs: [{ role: 'user', text: 'a', at: Date.parse('2026-10-28T10:00:00Z') }, { role: 'assistant', text: 'b', at: Date.parse('2026-10-28T10:00:03Z') }, { role: 'user', text: 'c', at: Date.parse('2026-10-28T10:01:00Z') }] },
  { id: 's2', at: Date.parse('2026-10-30T09:00:00Z'), msgs: [{ role: 'user', text: 'd', at: Date.parse('2026-10-30T09:00:00Z') }] },
  { id: 's3', at: Date.parse('2026-10-30T11:00:00Z'), msgs: [] }
];
const meta = P.metaFromSessions(sessions);
ok('会话统计：只数 user 轮次', meta.turns === 3, meta.turns);
ok('会话统计：只数非空会话', meta.sessions === 2, meta.sessions);
ok('会话统计：活跃天数 2 天', meta.days === 2, meta.days);
ok('会话统计：首次 ≤ 最近', Date.parse(meta.firstSeen) < Date.parse(meta.lastActive));

/* ---- 聚合 ---- */
const st = P.stats([lead1, lead2]);
ok('聚合：总数 2', st.n === 2, st.n);
ok('聚合：漏斗 6 段', st.funnel.length === 6);
ok('聚合：留资率 = 完整度≥75 占比', st.leadRate === 100, st.leadRate);
ok('聚合：高意向计数', st.hot === 2, st.hot);
ok('聚合：趋势按日升序', st.trend.every((t, i, a) => i === 0 || a[i - 1].day <= t.day));
ok('聚合：空数组不炸', P.stats([]).n === 0 && P.stats([]).leadRate === 0);

/* ---- CSV ---- */
const csv = P.toCsv([{ display_name: 'a,b', stage: 'qualified', intent_score: 80 }]);
ok('CSV：带 BOM 便于 Excel', csv.charCodeAt(0) === 0xFEFF);
ok('CSV：逗号字段被引号包住', csv.indexOf('"a,b"') > 0);
ok('CSV：表头含中文列名', csv.indexOf('意向分') > 0 && csv.indexOf('阶段') > 0);

/* ---- 存储：同步 / 幂等 / 删除 ---- */
const L = AP.Lead;
ok('存储：Node 环境退内存', L.adapterKind() === 'memory' || L.adapterKind() === 'idb', L.adapterKind());

const a1 = await L.syncFrom({ user, facts: fullFacts, sessions, consent: {} });
ok('同步：写入 1 条', (await L.all()).length === 1);
const a2 = await L.syncFrom({ user, facts: fullFacts, sessions, consent: { contact: true, at: '2026-10-30T01:00:00Z' } });
ok('同步：同人只更新同一行', (await L.all()).length === 1);
ok('同步：created_at 保留、updated_at 变化', a2.created_at === a1.created_at && a2.updated_at >= a1.updated_at);
ok('同步：多次同步后同意信息生效', a2.contact_email === 'alex@example.com');

await L.seedDemo(12);
const all = await L.all();
ok('演示：生成 12 条且标记 demo', all.filter((l) => l.demo).length === 12, all.filter((l) => l.demo).length);
ok('演示：与真实线索共存', all.length === 13, all.length);
await L.clearDemo();
ok('演示：清除后只剩真实线索', (await L.all()).length === 1);

const json = JSON.parse(L.exportJson(await L.all()));
ok('导出：JSON 可解析且含 leads', Array.isArray(json.leads) && json.leads.length === 1);

await L.clearMine('usr_test');
ok('删除我的：清空该账号线索', (await L.all()).length === 0);

await L.clear();
ok('全清：库为空', (await L.all()).length === 0);

console.log(`\n通过 ${pass} / ${pass + fail}`);
if (fail) { console.log('失败：'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通过 ✅');

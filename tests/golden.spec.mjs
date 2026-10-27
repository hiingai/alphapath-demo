// 黄金断言（CI 门禁）：三层守门 + 关键日期 + 合规 + 记忆 + 路由兜底
// 用法：node tests/golden.spec.mjs
import { loadEngine } from './engine_loader.mjs';

const { AP } = loadEngine();
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (extra ? ' → ' + extra : ''));
}
function has(text, sub, name) { ok(name, String(text).indexOf(sub) >= 0, '缺少「' + sub + '」'); }
function notHas(text, sub, name) { ok(name, String(text).indexOf(sub) < 0, '出现禁用「' + sub + '」'); }

/* ---------- 1. 时间线关键日期 ---------- */
const t = AP.timeline.compute_visa_timeline('TTPS_A', '2023-09-01');
ok('TTPS_A 首签到期 = 2026-09-01', t.expiry === '2026-09-01', t.expiry);
ok('TTPS_A 窗口起点 = 2026-06-03', t.applyWindow.start === '2026-06-03', t.applyWindow.start);
ok('TTPS_A 窗口截止 = 2026-07-21', t.applyWindow.deadline === '2026-07-21', t.applyWindow.deadline);
ok('TTPS_A 7 年届满 = 2030-09-01', t.prDate === '2030-09-01', t.prDate);
ok('TTPS_A 高峰提醒', t.isPeak === true, String(t.isPeak));
ok('TTPS_A 费用申请 600 港元', t.fees.application === 60000, String(t.fees.application));

const tQ = AP.timeline.compute_visa_timeline('QMAS', '2022-07-01');
ok('QMAS 三轮覆盖 ≥7 年', tQ.rounds.length >= 3, 'rounds=' + tQ.rounds.length);
const tStu = AP.timeline.compute_visa_timeline('STUDENT', '2024-09-01');
ok('STUDENT 特别提示含待法务确认', /待法务确认/.test(tStu.specialNotice || ''), tStu.specialNotice);
const tFdh = AP.timeline.compute_visa_timeline('FDH', '2023-03-30');
ok('FDH canPr=false', tFdh.canPr === false, String(tFdh.canPr));
ok('FDH 7 年届满为 null', tFdh.prDate === null, String(tFdh.prDate));

/* ---------- 2. 三层法定守门 ---------- */
const esls = AP.legal.legal_profile_of({ identityType: 'ESLS', segments: [] });
ok('ESLS tier=deny', esls.tier === 'deny', esls.tier);
ok('ESLS canPr=false', esls.canPr === false, String(esls.canPr));
ok('ESLS notices 有 deny', esls.notices.some((n) => n.tier === 'deny'));
ok('ESLS remedies 非空', (esls.notices[0].remedies || []).length > 0);

const dep = AP.legal.legal_profile_of({ identityType: 'DEPENDANT', segments: [] });
ok('DEPENDANT tier=cond', dep.tier === 'cond', dep.tier);
ok('DEPENDANT 有补救动作', dep.notices.some((n) => n.tier === 'cond' && (n.actions || []).length > 0));
ok('DEPENDANT monitor=120', dep.notices.some((n) => n.monitor && n.monitor.guardian_expiry_alert_days === 120));

const stu = AP.legal.legal_profile_of({ identityType: 'STUDENT', segments: [] });
ok('STUDENT tier=cond', stu.tier === 'cond', stu.tier);
ok('STUDENT 双口径并列', stu.notices.some((n) => n.dualBasis && n.dualBasis.length >= 2));
ok('STUDENT 标记待法务确认', stu.notices.some((n) => n.pendingLegalReview === true));

const gap = AP.legal.legal_profile_of({ identityType: 'TTPS_A', segments: [{ kind: 'gap', start: '2025-01-01', end: '2025-03-01' }] });
ok('gap tier=dwell', gap.tier === 'dwell', gap.tier);
ok('gap 服务入口仍可用', gap.notices.some((n) => n.serviceAvailable === true));

/* ---------- 3. 居住年限计算 ---------- */
const dw = AP.timeline.compute_dwell([
  { kind: 'visa', start: '2023-09-01', end: '2025-01-01' },
  { kind: 'gap', start: '2025-01-01', end: '2025-03-01' },
  { kind: 'visa', start: '2025-03-01', end: '2026-10-01' }
], '2026-10-01');
ok('gap 触发重新起算', dw.rebasedFrom === '2025-01-01', String(dw.rebasedFrom));
ok('gap 双口径并列', dw.dualRequired === true);
ok('gap 计入天数只算后半段', dw.creditedDays === 579, String(dw.creditedDays));

/* ---------- 4. 合规红线 ---------- */
const cp = AP.compliance.check_compliance({
  applicantInHk: true,
  employer: { registeredMonths: 3, hasOfficeLease: false }, mpfMonths: 2, declaredSalaryMonths: 6
});
ok('雇主信号触发风险', cp.result !== 'PASS', cp.result);
ok('两条信号 → BLOCK', cp.result === 'BLOCK', cp.result);
ok('风险分 = 0.8', Math.abs(cp.findings[0].riskScore - 0.8) < 1e-9, String(cp.findings[0].riskScore));
ok('不在港 → BLOCK', AP.compliance.check_compliance({ applicantInHk: false }).result === 'BLOCK');

/* ---------- 5. 输出守门（三层表述） ---------- */
const g1 = AP.guardrails.guard_output('ESLS 外劳可以申请永居。', 'deny');
notHas(g1.text, '可以申请永居', 'DENY 修复掉「可申请」暗示');
has(g1.text, '不产生永居', 'DENY 补上「不产生永居」');
ok('DENY 修复后给出替代路径', /替代路径|生活支持/.test(g1.text));

const g2 = AP.guardrails.guard_output('该段期间不计入 7 年，不可永居，服务被拦截。', 'dwell');
notHas(g2.text, '不可永居', 'DWELL 修复掉「不可永居」');
notHas(g2.text, '拦截', 'DWELL 修复掉「拦截」');
has(g2.text, '不计入', 'DWELL 保留「不计入」');
ok('DWELL 声明入口开放', /服务入口正常开放|入口/.test(g2.text));

const g3 = AP.guardrails.guard_output('受养人需要关注保证人。', 'cond');
has(g3.text, 'ROP145', 'COND 补上 ROP145 补救路径');

const g4 = AP.guardrails.guard_output('我们包过，保证通过。', null);
ok('C-003 禁用表述被拦', g4.blocked === true, String(g4.blocked));

const g5 = AP.guardrails.guard_output('怎么把逾期记录处理掉？', null);
ok('C-015 规避请求被拦', g5.blocked === true && /C-015/.test(g5.reason), g5.reason.slice(0, 40));

/* ---------- 6. 规则路由兜底 ---------- */
const agent = AP.Engine.createAgent();
const r1 = agent._route('我的高才通A类 2023-09-01 激活，帮我生成 7 年主航道');
ok('路由：时间线', r1 && r1.tool === 'compute_timeline', JSON.stringify(r1));
ok('路由：识别 TTPS_A', r1 && /identityType=TTPS_A/.test(r1.arg), r1 && r1.arg);
ok('路由：识别日期', r1 && /activationDate=2023-09-01/.test(r1.arg), r1 && r1.arg);
ok('路由：计算器', (agent._route('计算 12*(3+4)') || {}).tool === 'calculator');
ok('路由：外佣资质', (agent._route('外佣能不能拿永居') || {}).tool === 'legal_profile');
ok('路由：空档走 dwell', (agent._route('高才通有签证空档，算不算永居年限') || {}).tool === 'legal_profile');

/* ---------- 7. 端到端（离线）：三层表述 ---------- */
async function e2e() {
  const cases = [
    { q: '外佣能不能拿永居？', must: ['不产生永居'], mustNot: ['可以申请永居'] },
    { q: '受养人签证怎么办？', must: ['ROP145'], mustNot: [] },
    { q: '学生签证期间算不算 7 年', must: ['待法务确认'], mustNot: [] },
    { q: '我的高才通A类 2023-09-01 激活，帮我生成 7 年主航道', must: ['2026-09-01', '2030-09-01'], mustNot: [] },
    { q: '怎么把逾期记录处理掉？', must: ['C-015'], mustNot: ['可以帮你规避'] }
  ];
  for (const c of cases) {
    const a = AP.Engine.createAgent();
    const res = await a.chat(c.q, null, null);
    for (const m of c.must) has(res.reply, m, '端到端「' + c.q.slice(0, 14) + '」含 ' + m);
    for (const m of c.mustNot) notHas(res.reply, m, '端到端「' + c.q.slice(0, 14) + '」不含 ' + m);
  }

  /* 记忆：remember → recall */
  const a2 = AP.Engine.createAgent();
  await a2.chat('记住：我的生日是 3 月 5 日', null, null);
  const recalled = await a2.chat('你还记得吗', null, null);
  ok('记忆沉淀 + 召回', /生日/.test(recalled.reply), recalled.reply.slice(0, 60));

  /* 统计与语料 */
  const st = a2.stats();
  ok('语料 89 条', st.rag_coverage.total === 89, String(st.rag_coverage.total));
  ok('工具 16 个', st.tools === 16, String(st.tools));
}

const t0 = Date.now();
await e2e();
const cost = Date.now() - t0;

console.log('\n===== 黄金断言 =====');
console.log('通过 ' + pass + ' / ' + (pass + fail) + '，耗时 ' + cost + ' ms');
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');

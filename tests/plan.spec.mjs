/* 84 个月规划引擎测试：分段 / 缺口 / 排期确定性 / 双路径 / 风险 / HTML 安全与必备内容 */
import { loadEngine } from './engine_loader.mjs';

const { AP } = loadEngine();
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, got) => { if (c) pass++; else { fail++; failures.push(n + (got !== undefined ? ' → ' + JSON.stringify(got) : '')); } };

const P = AP.Plan;
const base = { identityType: 'TTPS_B', activationDate: '2025-09-01', employment: 'employed', dependants: 2, schoolStage: '中二', goal: 'pr' };

/* ---- 缺口 ---- */
ok('缺口：三项齐全时无缺口', P.gaps(base).length === 0, P.gaps(base));
ok('缺口：缺身份要问', P.gaps({ activationDate: '2025-09-01', employment: 'employed' }).join() === 'identityType');
ok('缺口：缺日期/工作都算', P.gaps({ identityType: 'TTPS_B' }).length === 2);
const asks = P.quickAsk({});
ok('提问：每个缺口一个问题', asks.length >= 3);
ok('提问：选项都可一键点（label+value）', asks.every((q) => q.opts.length >= 3 && q.opts.every((o) => o.label && o.value !== undefined)));
ok('提问：问题都很短（≤30 字）', asks.every((q) => q.text.length <= 30), asks.map((q) => q.text.length));

/* ---- 签证分段 ---- */
const segB = P._pure.segments(P._pure.ident('TTPS_B'));
ok('分段：高才B 2+3+3 共三段', segB.length === 3, segB.map((s) => s.label));
ok('分段：首段 24 个月', segB[0].from === 1 && segB[0].to === 24);
ok('分段：连续且覆盖到 84', segB[0].to + 1 === segB[1].from && segB[segB.length - 1].to >= 84);
const segQ = P._pure.segments(P._pure.ident('QMAS'));
ok('分段：优才 3+3+2 首段 36 个月', segQ[0].from === 1 && segQ[0].to === 36);
ok('分段：未知身份返回空', P.segments('NOPE').length === 0);

/* ---- 报告骨架 ---- */
const plan = P.build(base);
ok('报告：84 个月', plan.months === 84 && plan.timeline.length === 84, plan.timeline.length);
ok('报告：起算月正确', plan.startYm === '2025-09', plan.startYm);
ok('报告：永居目标 = 第 84 个月（2032-08）', plan.prYm === '2032-08', plan.prYm);
ok('报告：准备就绪标记', plan.ok === true);
ok('报告：含双路径', !!plan.tracks.employed && !!plan.tracks.self);
ok('报告：受雇为主路径', plan.tracks.primary === 'employed');
ok('报告：风险按等级分布', plan.risks.length >= 6 && plan.risks.some((r) => r.level === 'high'));
ok('报告：材料清单 ≥8 条', plan.evidence.length >= 8);
ok('报告：含免责声明', plan.disclaimers.length >= 3 && plan.disclaimers.join('').indexOf('不构成') > 0);
ok('报告：含规则版本与知识库指纹', !!plan.meta.ruleVersion && plan.meta.kbSha.length >= 8);

/* ---- 排期内容 ---- */
const t = plan.timeline;
ok('排期：第 1 个月有落地清单', t[0].acts.join('').indexOf('落地清单') >= 0);
ok('排期：第 24 个月附近有续签准备/递交', t.slice(20, 27).some((r) => r.prep) && t.slice(20, 27).some((r) => r.renewal));
ok('排期：每个月都有至少一个动作', t.every((r) => r.acts.length >= 1));
ok('排期：每年 4 月出现报税', t.filter((r) => r.month === 4 && r.acts.join('').indexOf('报税') >= 0).length >= 6);
ok('排期：每年 5 月核对强积金', t.filter((r) => r.month === 5 && r.acts.join('').indexOf('强积金') >= 0).length >= 6);
ok('排期：第 82 个月提交永居', t[81].acts.join('').indexOf('永久居民') >= 0, t[81].acts);
ok('排期：有子女时 9 月提学籍', t.filter((r) => r.month === 9 && r.acts.join('').indexOf('学籍') >= 0).length >= 6);

/* ---- 自雇 vs 受雇 ---- */
const planSelf = P.build(Object.assign({}, base, { employment: 'self-employed' }));
ok('自雇：主路径为自雇', planSelf.tracks.primary === 'self');
ok('自雇：风险含空壳认定', planSelf.risks.some((r) => r.id === 'shell'));
ok('受雇：风险不含空壳', !plan.risks.some((r) => r.id === 'shell'));
ok('自雇：排期提到审计/利得税', planSelf.timeline.slice(0, 12).concat(planSelf.timeline.filter((r) => r.month === 4)).map((r) => r.acts.join('')).join('').indexOf('审计') >= 0);
ok('未定路径：提示先定路径', P.build(Object.assign({}, base, { employment: 'unknown' })).timeline[0].acts.join('').indexOf('路径') >= 0);

/* ---- 强积金/收入 ---- */
const m1 = plan.money;
ok('强积金：未填收入不给单一数字', m1.mpfMonthly === null && m1.mpfScenarios.length === 3);
const m2 = P._pure.money({ monthlyIncome: 40000 });
ok('强积金：收入 4 万封顶 1500', m2.mpfMonthly === 1500, m2.mpfMonthly);
const m3 = P._pure.money({ monthlyIncome: 12000 });
ok('强积金：收入 1.2 万 = 600', m3.mpfMonthly === 600, m3.mpfMonthly);
const m4 = P._pure.money({ monthlyIncome: 5000 });
ok('强积金：低于下限按 7100 计 = 355', m4.mpfMonthly === 355, m4.mpfMonthly);

/* ---- 确定性 ---- */
const a1 = JSON.stringify(P.build(base).timeline);
const a2 = JSON.stringify(P.build(base).timeline);
ok('确定性：同档案两次生成完全一致', a1 === a2);
ok('确定性：不同激活日排期不同', JSON.stringify(P.build(Object.assign({}, base, { activationDate: '2024-03-01' })).timeline) !== a1);

/* ---- HTML ---- */
const html = P.toHtml(plan);
ok('HTML：完整文档', html.indexOf('<!DOCTYPE html>') === 0 && html.indexOf('</html>') > 0);
ok('HTML：内联样式（可离线打开）', html.indexOf('<style>') > 0 && html.indexOf('http://') < 0);
ok('HTML：含 84 行排期', (html.match(/<tr class="(renewal|prep)?"?|<tr><td class="m">M/g) || []).length >= 84, (html.match(/class="m"/g) || []).length);
ok('HTML：M1 与 M84 都在', html.indexOf('>M1<') > 0 && html.indexOf('>M84<') > 0);
ok('HTML：含强积金与银行流水章节', html.indexOf('强积金') > 0 && html.indexOf('银行流水') > 0);
ok('HTML：含风险评估章节', html.indexOf('风险评估') > 0);
ok('HTML：含免责声明', html.indexOf('不构成') > 0);
ok('HTML：可下载按钮', html.indexOf('dlBtn') > 0);
ok('HTML：转义注入内容', P.toHtml(P.build(Object.assign({}, base, { schoolStage: '<img src=x onerror=alert(1)>' }))).indexOf('<img src=x') < 0);
ok('HTML：打印样式存在', html.indexOf('@media print') > 0);
ok('HTML：未知身份也能出报告', P.toHtml(P.build({ identityType: 'NOPE', activationDate: '2025-01-01', employment: 'employed' })).indexOf('84 个月') > 0);

console.log(`\n通过 ${pass} / ${pass + fail}`);
if (fail) { console.log('失败：'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log('全部通过 ✅');

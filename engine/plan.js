/* AlphaPath · 84 个月续签规划引擎
 * 纯确定性：同一份档案永远生成同一份报告（便于测试与复盘）。
 * 红线：这里只排期、列材料、算供款、标风险；任何"能不能批"的结论都不写，统一指向官方与人工复核。
 */
(function (g) {
  'use strict';
  var AP = g.AP = g.AP || {};
  var MONTHS = 84;
  var KEY = ['identityType', 'activationDate', 'employment'];
  var OPTIONAL = ['dependants', 'schoolStage', 'goal', 'monthlyIncome'];

  var FIELD = {
    identityType: '身份类型', activationDate: '首次签证生效日', employment: '工作方式',
    dependants: '受养子女数', schoolStage: '孩子学段', goal: '主要诉求', monthlyIncome: '月收入（可选）'
  };

  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ym(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function kb() { return g.AP_KB && g.AP_KB.identityTypes ? g.AP_KB.identityTypes : {}; }
  function ident(key) {
    var t = kb()[key];
    return t ? {
      key: key, name: t.name, note: t.note || '', canPr: t.can_pr !== false,
      dependants: t.dependants !== false, firstYears: Number(t.first_years || 2),
      renew: String(t.renew || '2+3+3'), windowDays: Number(t.window_days || 28),
      leadDays: Number(t.lead_days || 0), peak: t.peak || []
    } : null;
  }

  /* 签证分段：首个签证期 + 续签串，累加到 84 个月 */
  function segments(info) {
    if (!info) return [];
    var out = [], m = 1, months = Math.round(info.firstYears * 12);
    out.push({ label: '第 1 个签证期（' + info.firstYears + ' 年）', from: 1, to: months, kind: 'visa' });
    m = months + 1;
    var parts = info.renew.split('+').map(function (x) { return parseFloat(x); }).filter(function (x) { return !isNaN(x); });
    var guard = 0;
    while (m <= MONTHS && guard < 8) {
      var y = parts.length ? parts[Math.min(guard, parts.length - 1)] : 3;
      var to = Math.min(MONTHS, m + Math.round(y * 12) - 1);
      out.push({ label: '续签第 ' + (out.length) + ' 次（' + y + ' 年）', from: m, to: to, kind: 'extension' });
      m = to + 1; guard++;
    }
    return out;
  }

  /* ---------------- 缺口与提问 ---------------- */
  function gaps(f) {
    f = f || {};
    return KEY.filter(function (k) { return !has(f[k]); });
  }

  function shiftMonths(n) {
    var d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01';
  }

  function quickAsk(f) {
    f = f || {};
    var q = [];
    if (!has(f.identityType)) q.push({
      key: 'identityType', text: '你走的是哪条通道？点一下就行。',
      opts: [{ label: '高才 A', value: 'TTPS_A', say: '我是高才A类' }, { label: '高才 B', value: 'TTPS_B', say: '我是高才B类' },
      { label: '高才 C', value: 'TTPS_C', say: '我是高才C类' }, { label: '优才', value: 'QMAS', say: '我是优才' },
      { label: '专才', value: 'ASMTP', say: '我是专才' }, { label: '进修 IANG', value: 'IANG', say: '我是IANG' }]
    });
    if (!has(f.activationDate)) q.push({
      key: 'activationDate', text: '首次签证哪个月生效？（决定 84 个月的起点）',
      opts: [{ label: '这个月', value: shiftMonths(0), say: shiftMonths(0) + ' 激活' },
      { label: '约 6 个月前', value: shiftMonths(-6), say: shiftMonths(-6) + ' 激活' },
      { label: '约 1 年前', value: shiftMonths(-12), say: shiftMonths(-12) + ' 激活' },
      { label: '约 2 年前', value: shiftMonths(-24), say: shiftMonths(-24) + ' 激活' }]
    });
    if (!has(f.employment)) q.push({
      key: 'employment', text: '接下来打算怎么在港工作？直接影响材料清单。',
      opts: [{ label: '受雇', value: 'employed', say: '我打算受雇上班' },
      { label: '自雇', value: 'self-employed', say: '我打算自己开公司' },
      { label: '还没定', value: 'unknown', say: '还没定，两种都想看看' }]
    });
    if (!has(f.dependants)) q.push({
      key: 'dependants', text: '有受养人一起过来吗？（影响学籍与材料）',
      opts: [{ label: '没有', value: 0, say: '没有受养人' }, { label: '1 个孩子', value: 1, say: '1 个孩子' },
      { label: '2 个孩子', value: 2, say: '2 个孩子' }, { label: '3 个', value: 3, say: '3 个孩子' }]
    });
    if (!has(f.monthlyIncome)) q.push({
      key: 'monthlyIncome', text: '月收入大概哪一档？（只用来估强积金）',
      opts: [{ label: '2 万以下', value: 15000, say: '月收入 2 万以下' },
      { label: '2–4 万', value: 30000, say: '月收入 2 到 4 万' },
      { label: '4–6 万', value: 50000, say: '月收入 4 到 6 万' },
      { label: '6 万以上', value: 70000, say: '月收入 6 万以上' }]
    });
    return q;
  }

  /* ---------------- 风险 ---------------- */
  function buildRisks(ctx) {
    var R = [];
    var self = ctx.employment === 'self-employed';
    var unknown = ctx.employment === 'unknown' || !ctx.employment;
    R.push({
      id: 'residence', title: '「通常居住」连续性被质疑', level: 'high',
      why: '7 年连续通常居住是永久居民的核心条件；长期离港、家庭与生活重心不在港，最容易在这一项上被追问。',
      fix: '每年在港时间、住址、工作、子女学籍四条线留痕；单次离港超过 1 个月做一次书面说明并留存机票、租房、公司证明。'
    });
    if (self) {
      R.push({
        id: 'shell', title: '自雇被认定为「空壳公司」', level: 'high',
        why: '只有公司注册证、没有真实业务流水与审计，是自雇续签最常见的拒因。',
        fix: '保留客户合同、发票、公司账户流水、办公室租约、强积金供款、审计报告与利得税报税表，形成完整业务证据链。'
      });
      R.push({
        id: 'audit', title: '审计/报税时间线断档', level: 'mid',
        why: '公司年结后未按时审计与报税，续签时无法证明业务真实与持续。',
        fix: '固定每年 4 月前完成审计底稿，报税表按期提交；把「年结日 + 审计 + 报税」写进日历。'
      });
    } else if (unknown) {
      R.push({
        id: 'track', title: '受雇/自雇路径未定，材料准备会空转', level: 'mid',
        why: '两条路径的证据链不同，晚定会压缩准备窗口（尤其自雇需要至少 12 个月业务记录）。',
        fix: '先用 2 周做一次路径选择：有雇主 offer 走受雇；想做业务则至少提前 12 个月搭公司架构。'
      });
    } else {
      R.push({
        id: 'employer', title: '雇主/岗位变动未按程序报备', level: 'mid',
        why: '专才类签证绑定雇主，换工作或岗位实质变更需重新申请；先离职后申请会出现签证空窗。',
        fix: '任何离职/转岗先在日历上标 90 天，先拿到新雇主材料再递交，保留旧雇主离职证明。'
      });
    }
    R.push({
      id: 'mpf', title: '强积金断供或漏供', level: 'mid',
      why: '强积金记录是受雇关系最直接的第三方证据；断供月份会被逐月对照。',
      fix: '受雇：确认雇主每月 10 日前供款；自雇：每年按时做自雇供款，保留供款记录与收入证明。'
    });
    R.push({
      id: 'bank', title: '银行流水与报税收入不一致', level: 'mid',
      why: '流水是收入的第一手证据，与报税/强积金对不上时，会被要求逐笔解释。',
      fix: '工资固定日期、固定账户入账；避免大额现金进出；每季度导出流水归档，年底与报税表核对一次。'
    });
    if (ctx.dependants > 0) {
      R.push({
        id: 'school', title: '子女学籍中断影响家庭在港联系', level: 'low',
        why: '学籍与在学证明是家庭生活重心的有力证据，频繁转学会削弱连续性。',
        fix: '插班前先确认学位与校网；保留在学证明、成绩单、学费收据。'
      });
    }
    if (ctx.monthlyIncome && ctx.monthlyIncome < 20000) {
      R.push({
        id: 'income', title: '收入偏低，续签时需额外说明', level: 'mid',
        why: '收入水平会被用来判断是否能维持自己与受养人在港生活。',
        fix: '准备雇佣合同、薪酬调整记录、配偶收入与资产证明，作为整体经济能力说明。'
      });
    }
    R.push({
      id: 'window', title: '错过续签递交窗口', level: 'high',
      why: '各通道的提前递交窗口不同（本通道约 ' + (ctx.info ? ctx.info.windowDays : 28) + ' 天），过期递交会造成逾期居留记录。',
      fix: '把每个签证到期日往前推 ' + ((ctx.info ? ctx.info.windowDays : 28) + 14) + ' 天设为提醒，材料在窗口开启前 1 个月备齐。'
    });
    R.push({
      id: 'fake', title: '材料真实性问题（零容忍）', level: 'high',
      why: '伪造雇佣、流水、住址证明一旦被查，除拒签外还可能涉及刑责。',
      fix: '所有材料必须可回源：合同有雇主盖章、流水可从银行补打、租约有印花。宁可补件，不要造件。'
    });
    return R;
  }

  /* ---------------- 双路径 ---------------- */
  function tracks(ctx) {
    var employed = {
      title: '受雇路径', fit: '有雇主 offer、收入稳定、岗位与学历匹配',
      steps: [
        { when: 'M1–M2', do: '签正式雇佣合同：职位、月薪、试用期、工作地点写清；确认岗位与签证类别匹配', doc: '雇佣合同、公司商业登记证副本' },
        { when: 'M1', do: '入职后确认雇主已做强积金登记（受雇 60 天内）', doc: 'MPF 登记通知、供款记录' },
        { when: '每月', do: '工资固定日期入同一银行账户，保留工资单', doc: '工资单、银行流水' },
        { when: '每年 4 月', do: '雇主报 IR56B、你报 BIR60；核对与强积金记录一致', doc: '报税表、评税通知书' },
        { when: '换工作时', do: '先拿新 offer 再离职；专才类需重新申请，避免空窗', doc: '新旧合同、离职证明、入境处批复' },
        { when: '续签前 3 个月', do: '准备雇主推荐信、在职证明、薪酬证明', doc: '雇主信、在职证明、最近 6 个月工资单' }
      ],
      risk: '绑定雇主：换工作/岗位实质变更未报备，会出现签证空窗'
    };
    var self = {
      title: '自雇路径', fit: '有真实业务、能提供合同与流水、愿意做审计与报税',
      steps: [
        { when: 'M1–M2', do: '注册有限公司 + 商业登记证；开公司账户（需业务证明）', doc: '公司注册证、商业登记证、公司章程' },
        { when: 'M2–M3', do: '建立业务证据链：客户合同、发票、采购单、办公地址租约', doc: '合同、发票、租约、印花' },
        { when: 'M3 起每月', do: '公司账户走业务收支；给自己发董事薪酬并做自雇强积金供款', doc: '公司流水、薪酬记录、MPF 供款' },
        { when: '每年', do: '做审计（核数师报告）+ 报利得税表；亏损也要报', doc: '审计报告、利得税报税表、评税通知' },
        { when: '续签前 6 个月', do: '整理业务说明：客户是谁、收入怎么来、雇了几个人', doc: '业务说明、客户清单、办公室照片' },
        { when: '持续', do: '避免「只有注册证、没有业务」的空壳形态', doc: '合同 + 流水 + 审计三件套齐全' }
      ],
      risk: '空壳认定：无真实业务流水与审计，自雇续签最容易被拒'
    };
    return { employed: employed, self: self, primary: ctx.employment === 'self-employed' ? 'self' : (ctx.employment === 'employed' ? 'employed' : 'both') };
  }

  /* ---------------- 钱：强积金 / 税 / 流水 ---------------- */
  function money(ctx) {
    var inc = Number(ctx.monthlyIncome || 0);
    var capped = Math.min(30000, Math.max(7100, inc || 0));
    var mpf = inc ? Math.min(1500, Math.round(capped * 0.05)) : null;
    var scen = [20000, 40000, 60000].map(function (v) {
      return { income: v, emp: Math.min(1500, Math.round(Math.min(30000, Math.max(7100, v)) * 0.05)) };
    });
    return {
      monthlyIncome: inc || null,
      mpfMonthly: mpf,
      mpfScenarios: scen,
      mpfNote: '雇员与雇主各供 5%，相关入息下限 7,100、上限 30,000/月（即最高 1,500/月）；自雇人士按年度有关入息供 5%，同样设上下限。数值以积金局最新公布为准。',
      taxNote: '薪俸税按年度申报（BIR60）；自雇另有利得税表。报税收入、强积金入息、银行流水三者要能对上。',
      bankRules: [
        '工资/业务收入固定日期进同一账户，备注写清来源',
        '避免大额现金存取与「整数进整数出」的可疑流水',
        '每月保留月结单，每季度导出一次 PDF 归档',
        '续签前准备最近 12 个月流水 + 6 个月平均结余说明',
        '公司账户与个人账户分开，股东往来要写清性质'
      ],
      buffer: '建议账户常备 3–6 个月家庭开支的结余，续签时作为「能维持生活」的旁证。'
    };
  }

  /* ---------------- 84 个月排期 ---------------- */
  function calendarOf(start, m) {
    var d = new Date(start.getFullYear(), start.getMonth() + m - 1, 1);
    return { date: d, ym: ym(d), month: d.getMonth() + 1, year: d.getFullYear() };
  }

  function buildTimeline(ctx) {
    var rows = [], segs = ctx.segments, start = ctx.start;
    var segStart = {};
    segs.forEach(function (s) { if (s.from > 1) segStart[s.from] = s; });
    var prep = Math.ceil((ctx.info ? ctx.info.windowDays : 28) / 30) + 1;

    for (var m = 1; m <= MONTHS; m++) {
      var c = calendarOf(start, m);
      var seg = segs.filter(function (s) { return m >= s.from && m <= s.to; })[0] || segs[segs.length - 1];
      var acts = [], docs = [], risk = '';

      if (m === 1) {
        acts.push('落地清单：身份证、住址证明、银行开户、强积金登记');
        docs.push('签证标签/电子签证、租约、银行开户回执');
      }
      if (m === 2) {
        acts.push('把签证到期日、续签窗口、报税月写进日历');
      }
      /* 续签准备与递交 */
      if (segStart[m + prep]) {   /* 续签窗口开启前 4 个月开始备料 */
        acts.push('启动续签：材料清单过一遍，缺口本月补');
        docs.push('续签申请表、雇佣/业务证明、住址证明');
        risk = '窗口约 ' + (ctx.info ? ctx.info.windowDays : 28) + ' 天后开启，别等最后一刻';
      }
      if (segStart[m]) {
        acts.push('递交续签并留回执；新签证期自本月起算');
        docs.push('递交回执、新签证批复');
      }
      /* 永居冲刺 */
      if (m === 79) {
        acts.push('永居申请预审：7 年居住记录、税单、强积金、工作证明打包');
        docs.push('出入境记录、7 年税单、强积金年报');
      }
      if (m === 82) {
        acts.push('提交永久居民申请（以满 7 年当月为准，具体日期按签证起算）');
        docs.push('申请表、居住证明、无犯罪记录（如要求）');
      }
      /* 年度固定动作 */
      if (c.month === 4) {
        acts.push(ctx.employment === 'self-employed' ? '报税月：公司审计定稿 + 利得税表' : '报税月：BIR60 / 雇主 IR56B 核对');
        docs.push('报税表、评税通知书');
      }
      if (c.month === 5) {
        acts.push('强积金年结：核对 12 个月供款是否连续');
        docs.push('MPF 周年报表');
      }
      if (c.month === 9 && ctx.dependants > 0) {
        acts.push('开学季：确认子女学籍与在学证明');
        docs.push('在学证明、学费收据');
      }
      if (c.month % 3 === 0) {
        acts.push('季度归档：银行流水导出 + 单据归位');
      }
      if (c.month === 1 && m > 1) {
        acts.push('年度自检：在港天数、住址、工作、学籍四条线');
      }
      /* 月度基线 */
      if (ctx.employment === 'self-employed') {
        acts.push('自雇基线：业务收支入公司账户、留发票、按年供 MPF');
      } else if (ctx.employment === 'employed') {
        acts.push('受雇基线：工资入账 + 工资单归档');
      } else {
        acts.push('本月确认路径（受雇/自雇），避免材料空转');
      }

      rows.push({
        m: m, ym: c.ym, year: c.year, month: c.month,
        phase: m <= 6 ? '落地期' : (m <= 24 ? '扎根期' : (m <= 60 ? '稳定期' : '冲刺期')),
        visa: seg ? seg.label : '', renewal: !!segStart[m], prep: !!segStart[m + prep],
        acts: acts, docs: docs, risk: risk
      });
    }
    return rows;
  }

  /* ---------------- 组装 ---------------- */
  function build(f, opts) {
    f = f || {}; opts = opts || {};
    var info = ident(f.identityType);
    var start = f.activationDate ? new Date(String(f.activationDate).slice(0, 8) + '01') : new Date();
    if (isNaN(start.getTime())) start = new Date();
    var ctx = {
      info: info, start: start, employment: f.employment || '',
      dependants: Number(f.dependants || 0), schoolStage: f.schoolStage || '',
      monthlyIncome: Number(f.monthlyIncome || 0)
    };
    ctx.segments = segments(info);
    var rows = buildTimeline(ctx);
    var prMonth = info && info.canPr ? 84 : null;
    var prDate = prMonth ? calendarOf(start, prMonth).ym : '';
    var plan = {
      meta: {
        build: (g.AP && AP.BUILD) || 'dev',
        generatedAt: new Date().toISOString(),
        ruleVersion: (g.AP_KB && AP_KB.meta && AP_KB.meta.ruleVersion) || 'policy.2026-10-06',
        kbSha: (g.AP_KB && AP_KB.meta && AP_KB.meta.sha256 || '').slice(0, 12)
      },
      ok: gaps(f).length === 0,
      missing: gaps(f),
      person: {
        identityType: f.identityType || '', identityName: info ? info.name : '待确认',
        activationDate: f.activationDate || '', employment: f.employment || 'unknown',
        dependants: Number(f.dependants || 0), schoolStage: f.schoolStage || '', goal: f.goal || ''
      },
      identity: info,
      months: MONTHS,
      startYm: ym(start),
      prYm: prDate,
      segments: ctx.segments,
      timeline: rows,
      tracks: tracks(ctx),
      money: money(ctx),
      risks: buildRisks(ctx),
      evidence: [
        { doc: '旅行证件 + 电子签证/签证标签', why: '确认每次签证期与到期日', when: '全程，每次续签后更新' },
        { doc: '雇佣合同 / 公司注册证 + 商业登记', why: '证明在港工作或经营的真实性', when: '入职/注册当月' },
        { doc: '强积金供款记录（年报）', why: '第三方证明受雇/自雇关系连续', when: '每年 5 月' },
        { doc: '报税表 + 评税通知书', why: '收入与纳税记录，与流水互相印证', when: '每年 4 月后' },
        { doc: '银行月结单（12 个月）', why: '收入与日常生活的第一手证据', when: '续签前 3 个月' },
        { doc: '住址证明（租约 + 水电/印花）', why: '证明生活重心在港', when: '每次搬家后' },
        { doc: '子女在学证明 / 成绩单', why: '家庭在港联系（如有受养人）', when: '每年 9 月' },
        { doc: '出入境记录', why: '核算「通常居住」天数', when: '每年 1 月 + 永居申请前' }
      ],
      disclaimers: [
        '本报告是「排期 + 材料清单 + 风险提示」，不是入境处的审批结论，也不构成法律意见。',
        '签证年期、续签窗口、永居条件以香港入境处最新公布为准；政策调整会让本报告的排期失效，使用前请核对官方页面。',
        '所有金额（强积金、税）为按公开规则估算，实际以积金局/税务局评税为准。',
        '报告由确定性规则生成（ruleVersion ' + ((g.AP_KB && AP_KB.meta && AP_KB.meta.ruleVersion) || 'policy.2026-10-06') + '），任何资格判断都需人工复核。'
      ]
    };
    return plan;
  }

  /* ---------------- HTML 报告 ---------------- */
  var LEVEL = { high: ['高风险', '#c0392b'], mid: ['中风险', '#b3760f'], low: ['低风险', '#12996a'] };
  var EMP = { employed: '受雇', 'self-employed': '自雇', unknown: '尚未确定', '': '尚未确定' };

  function toHtml(plan) {
    if (!plan) return '';
    var p = plan.person, my = plan.money;
    var rows = plan.timeline.map(function (r) {
      var mark = r.renewal ? ' class="renewal"' : (r.prep ? ' class="prep"' : '');
      return '<tr' + mark + '><td class="m">M' + r.m + '</td><td class="ym">' + r.ym + '</td>' +
        '<td>' + esc(r.phase) + '</td><td class="visa">' + esc(r.visa) + '</td>' +
        '<td><ul>' + r.acts.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' +
        (r.docs.length ? '<div class="docs">材料：' + r.docs.map(esc).join('、') + '</div>' : '') +
        (r.risk ? '<div class="rowrisk">⚠ ' + esc(r.risk) + '</div>' : '') + '</td></tr>';
    }).join('');

    var risks = plan.risks.map(function (r) {
      var lv = LEVEL[r.level] || LEVEL.mid;
      return '<div class="risk ' + r.level + '"><div class="rh"><span class="lv" style="background:' + lv[1] + '">' + lv[0] +
        '</span><b>' + esc(r.title) + '</b></div><p><b>为什么：</b>' + esc(r.why) + '</p><p><b>怎么补：</b>' + esc(r.fix) + '</p></div>';
    }).join('');

    var trackBlock = function (t, primary) {
      return '<div class="track' + (primary ? ' primary' : '') + '"><h3>' + esc(t.title) +
        (primary ? '<span class="pill">主路径</span>' : '') + '</h3><p class="fit">适合：' + esc(t.fit) + '</p>' +
        '<table class="steps"><thead><tr><th>时间</th><th>要做什么</th><th>留什么材料</th></tr></thead><tbody>' +
        t.steps.map(function (s) { return '<tr><td class="nowrap">' + esc(s.when) + '</td><td>' + esc(s.do) + '</td><td>' + esc(s.doc) + '</td></tr>'; }).join('') +
        '</tbody></table><p class="warn">主要风险：' + esc(t.risk) + '</p></div>';
    };

    var segRows = plan.segments.map(function (s) {
      return '<tr><td>' + esc(s.label) + '</td><td>M' + s.from + ' – M' + s.to + '</td><td>' +
        (s.kind === 'visa' ? '首个签证期' : '续签期') + '</td></tr>';
    }).join('');

    var evRows = plan.evidence.map(function (e) {
      return '<tr><td>' + esc(e.doc) + '</td><td>' + esc(e.why) + '</td><td class="nowrap">' + esc(e.when) + '</td></tr>';
    }).join('');

    var mpfRows = my.mpfScenarios.map(function (s) {
      return '<tr><td>HK$ ' + s.income.toLocaleString() + '</td><td>HK$ ' + s.emp.toLocaleString() + '</td><td>HK$ ' + (s.emp * 2).toLocaleString() + '</td></tr>';
    }).join('');

    return '<!DOCTYPE html><html lang="zh-Hans"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>84 个月续签规划 · ' + esc(p.identityName) + ' · AlphaPath</title><style>' + CSS + '</style></head><body>' +
      '<header class="cover"><div class="brand">🐟 AlphaPath</div><h1>84 个月续签路径规划</h1>' +
      '<p class="sub">' + esc(p.identityName) + '　·　起算 ' + esc(plan.startYm) + '　·　目标 ' + (plan.prYm ? ('永居申请 ' + esc(plan.prYm)) : '续签维持') + '</p>' +
      '<div class="facts">' +
      '<span>身份：' + esc(p.identityName) + '</span><span>激活：' + esc(p.activationDate || '未填') + '</span>' +
      '<span>工作：' + esc(EMP[p.employment] || p.employment) + '</span><span>受养子女：' + (p.dependants || 0) + '</span>' +
      (p.schoolStage ? '<span>学段：' + esc(p.schoolStage) + '</span>' : '') + '</div>' +
      '<p class="gen">生成时间 ' + esc(plan.meta.generatedAt.slice(0, 16).replace('T', ' ')) + '　·　规则版本 ' + esc(plan.meta.ruleVersion) +
      '　·　知识库 ' + esc(plan.meta.kbSha) + '　·　build ' + esc(plan.meta.build) + '</p>' +
      '<a class="dl no-print" href="#" id="dlBtn">⤓ 下载这份报告（HTML）</a></header>' +
      '<main>' +
      '<section><h2>1. 结论摘要</h2><ul class="sum">' +
      '<li>共 <b>' + plan.months + '</b> 个月：从 <b>' + esc(plan.startYm) + '</b> 到 <b>' + esc(plan.timeline[plan.timeline.length - 1].ym) + '</b>。</li>' +
      '<li>签证分段：<b>' + plan.segments.length + '</b> 段（' + plan.segments.map(function (s) { return s.label; }).join(' → ') + '）。</li>' +
      '<li>主路径：<b>' + (plan.tracks.primary === 'both' ? '受雇 / 自雇 待定' : esc(plan.tracks[plan.tracks.primary].title)) + '</b>；报告同时给出两条路径的材料清单。</li>' +
      '<li>风险项：<b>' + plan.risks.length + '</b> 条，其中高风险 <b>' + plan.risks.filter(function (r) { return r.level === 'high'; }).length + '</b> 条。</li>' +
      '<li>强积金：' + (my.mpfMonthly ? ('按你填的收入，约 <b>HK$ ' + my.mpfMonthly + '</b> / 月（个人部分）') : '未填收入，见下方三档估算') + '。</li>' +
      '</ul><p class="note">这不是「能不能批」的结论，而是把 84 个月要做的动作、要留的材料、会踩的坑排出来。</p></section>' +

      '<section><h2>2. 签证分段</h2><table class="t"><thead><tr><th>段</th><th>覆盖月份</th><th>性质</th></tr></thead><tbody>' + segRows + '</tbody></table>' +
      '<p class="note">每个通道的首次年期与续签串来自知识库（ruleVersion ' + esc(plan.meta.ruleVersion) + '）；政策变动时以入境处公布为准。</p></section>' +

      '<section><h2>3. 受雇 / 自雇 两条路径</h2><div class="tracks">' +
      trackBlock(plan.tracks.employed, plan.tracks.primary === 'employed') + trackBlock(plan.tracks.self, plan.tracks.primary === 'self') +
      '</div><p class="note">切换路径时：受雇转自雇，至少提前 12 个月把公司账户与业务流水跑起来；自雇转受雇，注意新雇主签证申请与旧签证到期日的衔接。</p></section>' +

      '<section><h2>4. 强积金 / 报税 / 银行流水</h2>' +
      '<p><b>强积金：</b>' + esc(my.mpfNote) + '</p>' +
      (my.mpfMonthly ? '<p class="note">按你填的 HK$ ' + my.monthlyIncome.toLocaleString() + ' / 月估算：你每月供 HK$ ' + my.mpfMonthly.toLocaleString() +
        '，连同雇主合计 HK$ ' + (my.mpfMonthly * 2).toLocaleString() + '；自雇则按年度有关入息一次/分期供 5%。</p>' : '') +
      '<table class="t small"><thead><tr><th>月收入</th><th>个人供款/月</th><th>连同雇主合计</th></tr></thead><tbody>' + mpfRows + '</tbody></table>' +
      '<p><b>报税：</b>' + esc(my.taxNote) + '</p>' +
      '<p><b>银行流水五条规矩：</b></p><ul class="sum">' + my.bankRules.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<p class="note">' + esc(my.buffer) + '</p></section>' +

      '<section><h2>5. 84 个月逐月排期</h2>' +
      '<p class="note">黄底＝续签准备月，绿底＝续签递交月。每月至少一件事，做完就能在续签时拿出材料。</p>' +
      '<table class="t plan"><thead><tr><th>月</th><th>年月</th><th>阶段</th><th>签证状态</th><th>本月动作 / 材料 / 风险</th></tr></thead><tbody>' + rows + '</tbody></table></section>' +

      '<section><h2>6. 风险评估</h2>' + risks + '</section>' +

      '<section><h2>7. 材料清单</h2><table class="t"><thead><tr><th>材料</th><th>为什么需要</th><th>什么时候准备</th></tr></thead><tbody>' + evRows + '</tbody></table></section>' +

      '<section><h2>8. 依据与免责</h2><ul class="sum">' + plan.disclaimers.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<p class="note">本报告由 AlphaPath 本地引擎生成，未上传对话内容；如需修改，回到对话补充信息即可重新生成。</p></section>' +
      '</main>' +
      '<footer>AlphaPath · 84 个月续签规划 · ' + esc(plan.meta.generatedAt.slice(0, 10)) + '</footer>' +
      '<script>(function(){var b=document.getElementById("dlBtn");if(!b)return;b.addEventListener("click",function(e){e.preventDefault();' +
      'var h=document.documentElement.outerHTML;var blob=new Blob([h],{type:"text/html;charset=utf-8"});' +
      'var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=' + JSON.stringify('AlphaPath-续签规划-' + (plan.person.identityType || 'plan') + '-' + plan.startYm + '.html') + ';' +
      'document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},800);});})();<\/script>' +
      '</body></html>';
  }

  var CSS = [
    ':root{--ink:#16202b;--muted:#5d6b7a;--line:#e2e8ef;--bg:#f7f9fc;--card:#fff;--brand:#2b7de0;--warn:#b3760f;--ok:#12996a;--bad:#c0392b}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}',
    '.cover{background:linear-gradient(135deg,#12335c,#2b7de0 70%);color:#fff;padding:44px 40px 32px}',
    '.cover .brand{font-size:14px;opacity:.85;letter-spacing:.08em}',
    '.cover h1{margin:10px 0 6px;font-size:30px;letter-spacing:-.01em}',
    '.cover .sub{margin:0;opacity:.9}',
    '.cover .facts{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 10px}',
    '.cover .facts span{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);padding:5px 10px;border-radius:999px;font-size:12.5px}',
    '.cover .gen{font-size:12px;opacity:.75;margin:6px 0 0}',
    '.dl{display:inline-block;margin-top:14px;background:#fff;color:#12335c;font-weight:600;text-decoration:none;padding:9px 16px;border-radius:10px;font-size:13.5px}',
    'main{max-width:1080px;margin:0 auto;padding:28px 20px 60px}',
    'section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:16px 0}',
    'h2{font-size:19px;margin:0 0 14px;padding-bottom:10px;border-bottom:1px solid var(--line)}',
    'h3{font-size:16px;margin:0 0 8px}',
    'table.t{width:100%;border-collapse:collapse;font-size:13.5px}',
    'table.t th,table.t td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}',
    'table.t thead th{background:#f2f6fb;font-size:12.5px;color:var(--muted);font-weight:600}',
    'table.t.small{font-size:13px}',
    'table.plan td.m{font-weight:600;white-space:nowrap}',
    'table.plan td.ym,table.plan td.visa{white-space:nowrap;color:var(--muted);font-size:12.5px}',
    'table.plan ul{margin:0;padding-left:16px}',
    'table.plan li{margin:2px 0}',
    'table.plan tr.renewal{background:#eef8f2}',
    'table.plan tr.prep{background:#fff8e8}',
    '.docs{margin-top:4px;font-size:12px;color:var(--muted)}',
    '.rowrisk{margin-top:4px;font-size:12.5px;color:var(--bad)}',
    '.sum{margin:0 0 10px;padding-left:18px}.sum li{margin:4px 0}',
    '.note{color:var(--muted);font-size:12.5px;margin:10px 0 0}',
    '.tracks{display:grid;grid-template-columns:1fr 1fr;gap:16px}',
    '.track{border:1px solid var(--line);border-radius:12px;padding:16px}',
    '.track.primary{border-color:#bcd7f7;box-shadow:0 0 0 3px rgba(43,125,224,.08)}',
    '.track .fit{color:var(--muted);font-size:13px;margin:0 0 10px}',
    'table.steps{width:100%;border-collapse:collapse;font-size:12.8px}',
    'table.steps th,table.steps td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}',
    'table.steps thead th{background:#f2f6fb;color:var(--muted);font-weight:600}',
    '.nowrap{white-space:nowrap}',
    '.warn{color:var(--bad);font-size:12.8px;margin:10px 0 0}',
    '.pill{background:var(--brand);color:#fff;font-size:11px;padding:2px 8px;border-radius:999px;margin-left:8px;vertical-align:2px}',
    '.risk{border:1px solid var(--line);border-left:4px solid var(--warn);border-radius:10px;padding:14px 16px;margin:0 0 12px}',
    '.risk.high{border-left-color:var(--bad)}.risk.low{border-left-color:var(--ok)}',
    '.risk .rh{display:flex;align-items:center;gap:10px;margin-bottom:6px}',
    '.risk .lv{color:#fff;font-size:11px;padding:2px 8px;border-radius:999px}',
    '.risk p{margin:4px 0;font-size:13.5px}',
    'footer{text-align:center;color:var(--muted);font-size:12.5px;padding:10px 0 40px}',
    '@media (max-width:820px){.tracks{grid-template-columns:1fr}main{padding:16px 12px 40px}section{padding:16px}.cover{padding:28px 20px}}',
    '@media print{body{background:#fff}.dl,.no-print{display:none!important}section{border:none;padding:0;margin:14px 0}table.plan tr{break-inside:avoid}.cover{background:#12335c!important;-webkit-print-color-adjust:exact}}'
  ].join('');

  AP.Plan = {
    MONTHS: MONTHS, FIELD: FIELD, KEY: KEY, OPTIONAL: OPTIONAL,
    build: build, toHtml: toHtml, gaps: gaps, quickAsk: quickAsk,
    segments: function (k) { return segments(ident(k)); },
    _pure: { ident: ident, segments: segments, buildTimeline: buildTimeline, buildRisks: buildRisks, money: money, tracks: tracks, calendarOf: calendarOf }
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* AlphaPath · 7 年主航道鱼骨图（确定性数据层）
 * 只做「把引擎算出来的时间线摊成骨图」这一件事：不猜日期，不含任何模型输出。
 * 输入：{ identityType, activationDate, today? }
 * 输出：{ ok, identityName, activation, today, expiry7y, progressPct, nodes[], milestone, warnings[] }
 */
(function (g) {
  'use strict';
  var AP = g.AP = g.AP || {};

  var KIND_LABEL = { '首签': '首签', '随主申': '受养 · 随主申', '学生课程': '学生课程' };

  function daysBetween(a, b) {
    var A = Date.parse(a + 'T00:00:00Z'), B = Date.parse(b + 'T00:00:00Z');
    if (isNaN(A) || isNaN(B)) return null;
    return Math.round((B - A) / 86400000);
  }
  function todayISO() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* 每个节点给一个「骨位」：右、左交替，像鱼骨一样挂在主脊两侧 */
  function build(opt) {
    opt = opt || {};
    var identityType = opt.identityType;
    var activationDate = opt.activationDate;
    var today = opt.today || todayISO();
    if (!identityType) return { ok: false, reason: 'NO_IDENTITY', message: '还没确定身份类型：高才 A/B/C、优才、专才、受养人…你的情况是哪一种？' };
    if (!activationDate) return { ok: false, reason: 'NO_DATE', message: '还缺「签证激活日期」（入境激活那天，不是获批日）。' };

    var ck = AP.timeline && AP.timeline.check_date ? AP.timeline.check_date(activationDate) : { ok: true, iso: activationDate };
    if (!ck.ok) return { ok: false, reason: 'BAD_DATE', message: ck.message };

    var t;
    try {
      t = AP.timeline.compute_visa_timeline(identityType, ck.iso);
    } catch (e) {
      return { ok: false, reason: (e && e.code) || 'ENGINE_ERROR', message: (e && e.message) || '引擎无法计算这条时间线。' };
    }
    if (!t || !t.rounds || !t.rounds.length) {
      return { ok: false, reason: 'NO_ROUNDS', message: '该身份类型（外佣 / 输入劳工 / 访客等）不产生 7 年续签轮次，骨图没有可画的节点——这本身就是结论：法律上不产生永居路径。' };
    }

    var totalDays = daysBetween(t.rounds[0].grant, t.prDate) || 0;
    var elapsed = daysBetween(t.rounds[0].grant, today);
    var progressPct = totalDays > 0 ? Math.max(0, Math.min(100, Math.round(elapsed / totalDays * 100))) : 0;

    var nodes = [];
    var warnings = [];

    /* 可选的「开始申请」节点：只做展示与核对，不参与任何日期推算 */
    var applyIso = null;
    if (opt.applyDate) {
      var ak = AP.timeline && AP.timeline.check_date ? AP.timeline.check_date(opt.applyDate) : { ok: true, iso: opt.applyDate };
      if (!ak.ok) return { ok: false, reason: 'BAD_APPLY_DATE', message: '申请日期：' + ak.message };
      applyIso = ak.iso;
      if (applyIso > t.rounds[0].grant) {
        warnings.push('申请日 ' + applyIso + ' 晚于激活日 ' + t.rounds[0].grant + '，顺序反了——请核对。');
      } else {
        var waitDays = daysBetween(applyIso, t.rounds[0].grant);
        if (waitDays !== null && waitDays >= 0) {
          warnings.push('从递交申请到签证激活：' + waitDays + ' 天（这段等待不计入 7 年）。');
        }
      }
    }
    if (!t.canPr || !t.prDate) {
      warnings.push('该身份类型不产生永居路径（tier = ' + t.tier + '）：骨图只画到续签轮次，不画 7 年届满。');
    }
    if (applyIso) {
      nodes.push({
        key: 'apply', label: '开始申请', date: applyIso, bone: 'left', kind: 'apply',
        detail: '递交申请（等待期不计入 7 年）',
        status: today >= applyIso ? 'done' : 'future'
      });
    }
    nodes.push({
      key: 'activation', label: '签证激活', date: t.rounds[0].grant, bone: 'right',
      detail: '7 年起算点', status: today >= t.rounds[0].grant ? 'done' : 'future', kind: 'start'
    });
    t.rounds.forEach(function (r, i) {
      var label = KIND_LABEL[r.kind] || r.kind;
      if (r.index > 1) label = '续签 ' + (r.index - 1);
      var status;
      if (today >= r.expiry) status = 'done';
      else if (today >= r.windowStart) status = 'current';
      else status = 'future';
      nodes.push({
        key: 'round' + r.index, label: label, date: r.expiry, bone: i % 2 === 0 ? 'left' : 'right',
        detail: '到期 · ' + (r.years || '') + ' 年', status: status, kind: 'renew',
        windowStart: r.windowStart, windowDeadline: r.windowDeadline, suggestedSubmitBy: r.suggestedSubmitBy,
        isPeak: r.isPeak
      });
      if (status === 'current') {
        warnings.push('第 ' + r.index + ' 轮正在递交窗口内：' + r.windowStart + ' ~ ' + r.windowDeadline
          + '（建议 ' + r.suggestedSubmitBy + ' 前递交' + (r.isPeak ? '，属高峰月' : '') + '）');
      }
    });
    if (t.canPr && t.prDate) nodes.push({
      key: 'seven', label: '7 年届满', date: t.prDate, bone: 'right', kind: 'finish',
      detail: '可申请永久居民（须通常居住连续 7 年，实际以入境处认定为准）',
      status: today >= t.prDate ? 'done' : 'future'
    });
    var next = nodes.filter(function (n) { return n.status === 'current' || n.status === 'future'; })[0] || null;

    /* 按日期排序：主脊要顺着时间读；同一天时把「7 年届满」排在续签之后 */
    nodes.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.kind === 'finish') return 1;
      if (b.kind === 'finish') return -1;
      return 0;
    });
    /* 骨位按排序后的顺序重新交替，视觉上才连贯 */
    nodes.forEach(function (n, i) { n.bone = i % 2 === 0 ? 'right' : 'left'; });
    next = nodes.filter(function (n) { return n.status === 'current' || n.status === 'future'; })[0] || null;

    return {
      ok: true,
      identityType: identityType,
      identityName: (AP_KB && AP_KB.identityTypes && AP_KB.identityTypes[identityType] || {}).name || identityType,
      tier: t.tier,
      activation: t.rounds[0].grant,
      applyDate: applyIso,
      today: today,
      expiry7y: t.prDate,
      progressPct: progressPct,
      daysLeft: totalDays - Math.max(0, elapsed),
      nodes: nodes,
      next: next,
      warnings: warnings,
      ruleVersion: (t.ruleVersion || (AP_KB && AP_KB.ruleVersion) || '')
    };
  }

  /* 给 UI 用的短文案：一句话总结当前进度 */
  function summary(f) {
    if (!f || !f.ok) return (f && f.message) || '还不能画进度图。';
    if (f.progressPct >= 100) return '7 年已届满（' + f.expiry7y + '），可评估永久居民申请；最终以入境处认定为准。';
    var n = f.next;
    if (!n) return '7 年主航道已画好，共 ' + f.nodes.length + ' 个节点。';
    if (n.status === 'current' && n.windowStart) {
      return '当前在第 ' + (n.label || '') + ' 递交窗口（' + n.windowStart + ' ~ ' + n.windowDeadline + '），建议 ' + n.suggestedSubmitBy + ' 前递交。';
    }
    return '下一个节点：' + n.label + ' · ' + n.date + '；距 7 年届满还有 ' + Math.max(0, f.daysLeft) + ' 天。';
  }

  AP.fishbone = { build: build, summary: summary, todayISO: todayISO };
})(typeof window !== 'undefined' ? window : globalThis);

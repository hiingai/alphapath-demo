/* AlphaPath · 教育域（移植自 v1.4 agent/domain/matching.py）
 * 择校匹配（出口优先）+ 升学路径推演（耦合 C4/C5/C9/C10）。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});
  var KB = global.AP_KB;
  var TL = AP.timeline;

  function match_schools(q) {
    q = q || {};
    var lst = KB.schools.slice();
    if (q.stage) lst = lst.filter(function (s) { return s.stage === q.stage; });
    if (q.curriculum) lst = lst.filter(function (s) { return s.curricula.indexOf(q.curriculum) >= 0; });
    if (q.district) lst = lst.filter(function (s) { return s.district === q.district; });
    if (q.type) lst = lst.filter(function (s) { return s.type === q.type; });
    if (q.maxTuition !== undefined && q.maxTuition !== null) {
      lst = lst.filter(function (s) { return s.tuition <= q.maxTuition; });
    }
    if (q.outcome) {
      var valid = KB.curricula.filter(function (c) { return c.outcome.indexOf(q.outcome) >= 0; })
        .map(function (c) { return c.id; });
      lst = lst.filter(function (s) {
        return s.curricula.some(function (c) { return valid.indexOf(c) >= 0; }) || s.curricula.indexOf('—') >= 0;
      });
    }
    var out = lst.map(function (s) {
      var reasons = [], score = 60;
      if (q.stage && s.stage === q.stage) { score += 15; reasons.push('学段匹配'); }
      if (q.curriculum && s.curricula.indexOf(q.curriculum) >= 0) { score += 15; reasons.push('课程体系匹配'); }
      if (q.district && s.district === q.district) { score += 10; reasons.push('校网匹配'); }
      if (String(s.band || '').indexOf('Band 1') === 0) { score += 5; reasons.push('热门 Band 1（民间口径，非官方排名）'); }
      if (!s.accredited) { score -= 30; reasons.push('⚠️ 非本地评审课程：毕业后无法办理 IANG'); }
      var item = JSON.parse(JSON.stringify(s));
      item.score = Math.max(0, Math.min(100, score));
      item.reasons = reasons;
      return item;
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function pathway_plan(outcome, exam_year, activation_date, identity_type) {
    var it = KB.identityTypes[identity_type] || {};
    var result = { outcome: outcome, examYear: exam_year, checks: [], feasible: true, notes: [] };
    if (outcome === 'MAINLAND') {
      var latest = (exam_year - 1) + '-09-01';
      var pr = activation_date ? TL.add_years(activation_date, 7) : null;
      var buffer = pr ? TL.diff_days(latest, pr) : null;
      var passed = !!(pr && TL._p(pr) <= TL._p(latest));
      result.feasible = passed;
      var message;
      if (passed) {
        message = '可行：永居届满日 ' + pr + ' 早于最晚需拿永居日 ' + latest + '，缓冲 ' + Math.floor(buffer / 30) + ' 个月。';
      } else if (pr) {
        message = '⚠️ 存在风险：永居届满日 ' + pr + ' 晚于最晚需拿永居日 ' + latest + '，差 '
          + Math.floor((Math.abs(buffer) + 29) / 30) + ' 个月。方案：① 提前启动身份 ② 评估顶尖人才加速 ③ 调整升学目标。';
      } else {
        message = '需先确定身份激活日才能反推。';
      }
      result.checks.push({
        rule: 'C4', name: 'DSE 报考内地高校 / 华侨生联考', require: '通常需香港永居 + 回乡证',
        latestPrDate: latest, prDate: pr, bufferDays: buffer, passed: passed, message: message
      });
      if (it.tier === 'deny') {
        result.feasible = false;
        result.notes.push('该身份不产生永居路径，无法满足内地高校身份前置条件。');
      }
      if (identity_type === 'STUDENT') {
        result.notes.push('学生签证计入口径见 R-CALC-014（待法务确认），本推演按保守口径。');
      }
    } else if (outcome === 'HK') {
      result.checks.push({
        rule: 'C2', name: '本地生学费', require: '香港居民身份',
        passed: it.tier !== 'deny',
        message: '身份未激活年份将按非本地生学费计，请留意学费差额。'
      });
      if (it.tier === 'deny') {
        result.feasible = false;
        result.notes.push('① 层身份子女教育权益受限，请以生活支持链路评估。');
      }
    } else {
      result.checks.push({
        rule: '—', name: '海外升学', require: '通常无身份硬门槛', passed: true,
        message: '以课程成绩与语言要求为主。'
      });
    }
    return result;
  }

  function study_immigration_plan(degree, years, accredited, activation_date) {
    var plan = { degree: degree, steps: [], notes: [], accredited: !!accredited };
    if (!accredited) {
      plan.blocked = true;
      plan.notes.push('⛔ 非本地评审课程毕业后无法办理 IANG，不能衔接永居（C-005 / P-EDU-IANG-01）。');
      return plan;
    }
    var study_end = years || { PG: 1, UG: 4, ASSOC: 2 }[degree] || 3;
    plan.steps.push({ stage: '学生签证', years: study_end });
    plan.steps.push({ stage: 'IANG 首签', years: 2, coupling: 'C10', note: '毕业 6 个月内申请，断档预警。' });
    plan.notes.push('学生签证期间是否计入 7 年存在口径分歧 R-CALC-014（待法务确认），并列展示两种口径，不给单一结论。');
    if (activation_date) {
      plan.conservativePrDate = TL.add_years(activation_date, study_end + 7);
      plan.optimisticPrDate = TL.add_years(activation_date, 7);
    }
    plan.notes.push('IANG 期满需转工作签证，需雇主资质 + 薪资达标；身份衔接不能有空档。');
    return plan;
  }

  AP.matching = {
    match_schools: match_schools, pathway_plan: pathway_plan, study_immigration_plan: study_immigration_plan
  };
})(typeof window !== 'undefined' ? window : globalThis);

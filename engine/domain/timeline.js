/* AlphaPath · 时间线引擎（移植自 v1.4 agent/domain/timeline.py）
 * 纪律：LLM 永不重算日期，全部日期计算走这里。全部按 UTC 纯日期运算，避免时区漂移。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});
  var KB = global.AP_KB;

  var FEE = { application: 60000, issuance: 130000 }; /* 单位：分 */

  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }

  function p(s) {
    var t = String(s).slice(0, 10).split('-');
    return new Date(Date.UTC(parseInt(t[0], 10), parseInt(t[1], 10) - 1, parseInt(t[2], 10)));
  }
  function iso(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  /* ---------- 日期合法性校验 ----------
   * Date.UTC 会把 2023-09-31 悄悄滚成 2023-10-01，静默算错一整天。
   * 结论必须可信，所以非法日期一律不计算，先让用户确认。 */
  function check_date(s) {
    var raw = String(s == null ? '' : s).trim();
    var m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) {
      return {
        ok: false, input: raw, code: 'FORMAT',
        message: '日期「' + raw + '」格式看不懂，我需要「年-月-日」这样写，例如 2023-09-30。',
        suggestions: []
      };
    }
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    if (y < 1900 || y > 2100) {
      return {
        ok: false, input: raw, code: 'YEAR_RANGE',
        message: '年份 ' + y + ' 超出我能处理的范围（1900–2100），请确认激活签证的年份。',
        suggestions: []
      };
    }
    if (mo < 1 || mo > 12) {
      return {
        ok: false, input: raw, code: 'MONTH_RANGE',
        message: '月份 ' + mo + ' 不存在：一年只有 12 个月。请确认激活日期是 ' + y + ' 年几月。',
        suggestions: []
      };
    }
    var dim = daysInMonth(y, mo);
    if (d < 1 || d > dim) {
      /* 给两个最可能的候选：本月最后一天 / 下月第一天 */
      var lastDay = y + '-' + pad(mo) + '-' + pad(dim);
      var nextY = mo === 12 ? y + 1 : y, nextM = mo === 12 ? 1 : mo + 1;
      var firstNext = nextY + '-' + pad(nextM) + '-01';
      return {
        ok: false, input: raw, code: 'DAY_RANGE',
        message: '日期「' + raw + '」不存在：' + y + ' 年 ' + mo + ' 月只有 ' + dim + ' 天，没有 ' + d + ' 号。'
          + '你指的是 ' + lastDay + '（当月最后一天）还是 ' + firstNext + '（次日）？',
        suggestions: [lastDay, firstNext]
      };
    }
    return { ok: true, iso: y + '-' + pad(mo) + '-' + pad(d), input: raw };
  }
  function is_valid_date(s) { return check_date(s).ok; }

  function addMonthsDate(d, n) {
    var m = d.getUTCMonth() + n;
    var y = d.getUTCFullYear() + Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    var day = Math.min(d.getUTCDate(), daysInMonth(y, m + 1));
    return new Date(Date.UTC(y, m, day));
  }
  function addDaysDate(d, n) { return new Date(d.getTime() + n * 86400000); }

  function add_days(s, n) { return iso(addDaysDate(p(s), n)); }
  function add_months(s, n) { return iso(addMonthsDate(p(s), n)); }
  function add_years(s, n) { return add_months(s, n * 12); }
  function diff_days(a, b) { return Math.round((p(b) - p(a)) / 86400000); }
  function months_between(a, b) {
    var da = p(a), db = p(b);
    return (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
  }

  function compute_window(expiry, window_days, lead_days, peak) {
    var ws = add_days(expiry, -window_days);
    var wd = lead_days > 0 ? add_days(expiry, -lead_days) : expiry;
    var is_peak = (peak || []).indexOf(p(expiry).getUTCMonth() + 1) >= 0;
    var submit = is_peak ? add_days(wd, -28) : wd;
    return { windowStart: ws, windowDeadline: wd, isPeak: is_peak, suggestedSubmitBy: submit };
  }

  function compute_visa_timeline(identity_type, activation_date) {
    var it = (KB.identityTypes || {})[identity_type];
    if (!it) throw new Error('UNKNOWN_IDENTITY_TYPE:' + identity_type);
    /* 非法日期一律拒绝：宁可不答，也不能静默滚到次日算错一整天 */
    var ck = check_date(activation_date);
    if (!ck.ok) {
      var err = new Error(ck.message);
      err.code = 'BAD_DATE';
      err.dateCheck = ck;
      throw err;
    }
    var activation = ck.iso;
    var first_years = it.first_years;
    var first_expiry = add_months(activation, first_years * 12);
    var w0 = compute_window(first_expiry, it.window_days, it.lead_days, it.peak);
    var base = {
      activation: activation, identityType: identity_type, identityName: it.name,
      canPr: it.can_pr, tier: it.tier, expiry: first_expiry,
      applyWindow: { start: w0.windowStart, deadline: w0.windowDeadline },
      isPeak: w0.isPeak, suggestedSubmitBy: w0.suggestedSubmitBy,
      fees: FEE, ruleVersion: 'policy.2026-10-06',
      prDate: it.can_pr ? add_years(activation, 7) : null,
      rounds: [], specialNotice: null
    };
    if (!it.can_pr) {
      if (it.tier === 'deny') base.specialNotice = '该身份在法律上不产生永居路径，系统仅提供在港工作与生活支持。';
      else if (it.tier === 'special') base.specialNotice = '单程证属《基本法》第 24 条其他类别，不按 7 年计算路径。';
      else base.specialNotice = '该段期间不计入 7 年；服务入口正常开放。';
      return base;
    }
    if (identity_type === 'STUDENT') {
      base.specialNotice = '学生签证毕业后 6 个月内可转 IANG（C10）；读书期是否计入 7 年见 R-CALC-014（待法务确认）。';
      base.rounds.push(Object.assign({ index: 1, kind: '学生课程', grant: activation, expiry: first_expiry }, w0));
      return base;
    }
    if (identity_type === 'DEPENDANT') {
      base.specialNotice = '受养人签证年期随保证人；保证人失效则年期冻结（已累计部分不清零），见 C-011。';
      base.rounds.push(Object.assign({ index: 1, kind: '随主申', grant: activation, expiry: first_expiry }, w0));
      return base;
    }

    var pattern = String(it.renew).split('+')
      .filter(function (x) { return /^\s*\d+\s*$/.test(x); })
      .map(function (x) { return parseInt(x, 10); });
    base.rounds.push(Object.assign({ index: 1, kind: '首签', grant: activation, expiry: first_expiry }, w0));
    if (pattern.length) {
      var cursor = first_expiry, total = first_years * 12, idx = 2;
      for (var i = 0; i < pattern.length; i++) {
        var yrs = pattern[i];
        var nxt = add_months(cursor, yrs * 12);
        var w = compute_window(nxt, it.window_days, it.lead_days, it.peak);
        base.rounds.push({
          index: idx, kind: '续签 ' + (i + 1), grant: cursor, expiry: nxt, years: yrs,
          windowStart: w.windowStart, windowDeadline: w.windowDeadline,
          isPeak: w.isPeak, suggestedSubmitBy: w.suggestedSubmitBy
        });
        idx += 1;
        total += yrs * 12;
        cursor = nxt;
        if (total >= 84) break;
      }
    }
    return base;
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function compute_dwell(segments, as_of) {
    var end0 = as_of || todayISO();
    var segs = (segments || []).slice().sort(function (a, b) {
      return a.start < b.start ? -1 : (a.start > b.start ? 1 : 0);
    });
    var exclusions = [], credited = 0, before_rebase = null, rebased_from = null;
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var seg_end = p(seg.end) <= p(end0) ? seg.end : end0;
      var days = Math.max(0, diff_days(seg.start, seg_end));
      var kind = seg.kind;
      if (kind === 'visa') {
        credited += days;
      } else if (kind === 'visitor') {
        exclusions.push({ ruleId: 'R-CALC-011', kind: 'visitor', effect: 'exclude', days: days });
      } else if (kind === 'gap') {
        before_rebase = credited; credited = 0; rebased_from = seg.start;
        exclusions.push({ ruleId: 'R-CALC-012', kind: 'gap', effect: 'rebase', days: days });
      } else if (kind === 'overstay') {
        exclusions.push({ ruleId: 'R-CALC-013', kind: 'overstay', effect: 'exclude_flagged', days: days, flagged: true });
      }
    }
    var res = {
      asOf: end0, creditedDays: credited, creditedYears: Math.floor(credited / 365),
      creditedMonths: Math.floor((credited % 365) / 30),
      progress: Math.min(1, credited / (365 * 7)),
      exclusions: exclusions, rebasedFrom: rebased_from
    };
    if (rebased_from) {
      res.dualRequired = true;
      res.dual = {
        baseA: { label: '按重新起算（保守口径）', years: Math.floor(credited / 365), days: credited },
        baseB: {
          label: '含空档前累计（并列参考）',
          years: Math.floor((credited + (before_rebase || 0)) / 365),
          days: credited + (before_rebase || 0)
        }
      };
    }
    return res;
  }

  AP.timeline = {
    FEE: FEE, p: p, iso: iso, add_days: add_days, add_months: add_months, add_years: add_years,
    diff_days: diff_days, months_between: months_between, _p: p, _iso: iso,
    check_date: check_date, is_valid_date: is_valid_date,
    compute_window: compute_window, compute_visa_timeline: compute_visa_timeline,
    compute_dwell: compute_dwell, todayISO: todayISO
  };
})(typeof window !== 'undefined' ? window : globalThis);

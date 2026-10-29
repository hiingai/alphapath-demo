/* AlphaPath · 输出守门（移植自 v1.4 agent/guardrails.py）
 * ① DENY：必须声明「法律上不产生永居路径」+ 强制给合规替代路径
 * ② DWELL：只修年限、不拦服务；不得出现「不可永居」「拦截」
 * ③ COND：条件告警 + 必须给 ROP145 等补救路径
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});
  var CP = AP.compliance;

  var C015_REASON = 'C-015：本平台只陈述法律事实（逾期期间不计入 7 年，其后合法期可重新起算），'
    + '不提供任何规避、包装或「处理掉记录」的操作建议。';

  /* 输出侧判断：只有当回答本身在「提供规避手段」时才拦。
   * 关键区别——引述用户原话（你之前问「怎么把逾期记录处理掉」）是解释与拒绝，不是提供手段，
   * 这里曾经误杀过大量正常回答（尤其长对话里复述问题、做材料清单、生成文件时）。 */
  var QUOTE_MARK = new RegExp(
    '((你|您|用户|客户)(之前|刚才|刚刚|上面|前面)?(问|说|提到|询|要求)|你说的|你提到的'
    + '|「[^」]{0,40}(逾期|超期|规避|处理掉|洗白)[^」]{0,40}」'
    + '|"[^"]{0,40}(逾期|超期|规避)[^"]{0,40}")'
  );

  function is_evasion_output(text) {
    if (CP.is_evasion_output) return CP.is_evasion_output(text);
    var t = String(text == null ? '' : text);
    if (!CP.is_evasion_request(t)) return false;
    if (QUOTE_MARK.test(t)) return false;
    return true;
  }

  var DENY_REQUIRED = ['不产生永居', '不产生永久', '无永居路径', '不产生 永居', '不产生'];
  var DENY_FORBIDDEN = ['可以申请永居', '可申请永久', '能够永居', '可拿永居', '可以永居', '仍可申请永居',
    '符合永居条件', '可以拿永居'];
  var DWELL_FORBIDDEN = ['不可永居', '不能永居', '无法永居', '不可申请永居', '不能申请永居', '无法申请永居',
    '拦截', '拒绝服务', '入口关闭', '不可用', '不能续签', '资格取消'];
  var DWELL_REQUIRED = ['不计入'];
  var COND_REQUIRED = ['ROP145', '补救', '转换', '衔接', 'action'];

  var TIER_NORMS = {
    deny: '① 层（法律上不产生永居路径）：须明确不可永居并给合规替代路径。',
    dwell: '② 层（期间不计入）：只修年限、不拦服务、不隐藏入口。',
    cond: '③ 层（条件性资格）：条件告警 + 必须给 ROP145 等补救路径。'
  };

  var LOW_CONFIDENCE = 0.55;

  function hits(text, terms) {
    var t = text || '';
    return terms.filter(function (x) { return t.indexOf(x) >= 0; });
  }

  function validate_tier_text(tier, text) {
    if (!tier || tier === 'normal' || tier === 'special') return { ok: true, violations: [], tier: tier };
    text = text || '';
    var violations = [];
    var lint = CP.lint_text(text);
    if (!lint.ok) violations.push('禁用表述：' + lint.hits.join('、'));
    if (tier === 'deny') {
      if (!hits(text, DENY_REQUIRED).length) violations.push('① 层缺少「法律上不产生永居路径」的明确声明');
      var bad = hits(text, DENY_FORBIDDEN);
      if (bad.length) violations.push('① 层出现「可申请」暗示：' + bad.join('、'));
      if (!hits(text, ['替代路径', '在港工作与生活支持', '转换', '生活支持']).length) {
        violations.push('① 层缺少合规替代路径');
      }
    } else if (tier === 'dwell') {
      var bad2 = hits(text, DWELL_FORBIDDEN);
      if (bad2.length) violations.push('② 层出现禁止语义：' + bad2.join('、'));
      if (!hits(text, DWELL_REQUIRED).length) violations.push('② 层缺少「这段期间不计入」表述');
      if (!hits(text, ['入口', '服务', '正常开放', '不受影响']).length) violations.push('② 层未声明服务入口正常开放');
    } else if (tier === 'cond') {
      if (!hits(text, COND_REQUIRED).length) violations.push('③ 层缺少补救路径（ROP145 等）');
    }
    return { ok: violations.length === 0, violations: violations, tier: tier };
  }

  function sanitize_tier_text(tier, text) {
    text = text || '';
    if (tier === 'dwell') {
      /* ② 层只修年限、不拦服务：把「不可永居 / 拦截」类表述换成中性说法，
       * 并保证一定出现「服务入口正常开放」——原实现会拼出「服务被提示。」这种病句。 */
      /* 「被拦截」先退化成「拦截」，否则会拼出「服务被不受影响」 */
      text = text.split('被拦截').join('拦截');
      DWELL_FORBIDDEN.forEach(function (bad) {
        if (bad.indexOf('拦截') >= 0 || bad.indexOf('不可用') >= 0 || bad.indexOf('拒绝服务') >= 0
          || bad.indexOf('入口') >= 0 || bad.indexOf('不能续签') >= 0 || bad.indexOf('资格取消') >= 0) {
          text = text.split(bad).join('不受影响');
        } else {
          text = text.split(bad).join('该期间不计入');
        }
      });
      /* 去掉重复：「…不计入 7 年，该期间不计入」→ 只留一次 */
      text = text.replace(/不计入([^，。；]*)[，、]\s*该(?:段)?期间不计入/g, '不计入$1');
      text = text.replace(/(该(?:段)?期间不计入[^，。；]*)[，、]?\s*该(?:段)?期间不计入/g, '$1');
      if (text.indexOf('不计入') < 0) {
        text = '该段期间不计入 7 年。' + text;
      }
      if (!/服务入口正常开放/.test(text)) {
        text = text.replace(/[。\s]*$/, '') + '。服务入口正常开放；其后合法居留期可重新起算 7 年。';
      }
    } else if (tier === 'deny') {
      if (text.indexOf('不产生永居') < 0) text = '【身份定性前置】该身份在法律上不产生永居路径。' + text;
      text = text.split('可以申请永居').join('不产生永居路径').split('可申请永久').join('不产生永居路径');
      if (text.indexOf('替代路径') < 0 && text.indexOf('生活支持') < 0) {
        text += ' 本平台将服务重定位为「在港工作与生活支持」，并提供转换其他可累积身份的可行性评估（合规替代路径）。';
      }
    } else if (tier === 'cond') {
      if (text.indexOf('ROP145') < 0 && text.indexOf('补救') < 0) {
        text += ' 补救路径：满 7 年可独立申请 ROP145 核实永久性居民身份证资格（无须保证人同意）。';
      }
    }
    return text;
  }

  function guard_output(text, tier, confidence) {
    if (is_evasion_output(text)) {
      return { blocked: true, reason: C015_REASON, lint: { ok: true, hits: [] }, text: '', tierCheck: null, escalation: null, confidence: 1.0 };
    }
    var base = CP.guard_output(text);
    if (base.blocked) {
      return { blocked: true, reason: base.reason, lint: base.lint, text: '', tierCheck: null, escalation: null, confidence: 1.0 };
    }
    var result = { blocked: false, reason: '', lint: base.lint, text: text, tierCheck: null, escalation: null, confidence: 1.0 };
    var check = validate_tier_text(tier, text);
    result.tierCheck = check;
    if (!check.ok) {
      var repaired = sanitize_tier_text(tier, text);
      var recheck = validate_tier_text(tier, repaired);
      result.text = repaired;
      result.tierCheck = recheck;
      if (!recheck.ok) {
        result.escalation = {
          required: true, tier: tier, reason: '三层表述修复后仍不合规，转人工复核', violations: recheck.violations
        };
        result.confidence = LOW_CONFIDENCE;
      }
    }
    if (confidence !== undefined && confidence !== null) {
      result.confidence = Math.min(result.confidence, confidence);
    }
    if (result.confidence < LOW_CONFIDENCE && !result.escalation) {
      result.escalation = {
        required: true, tier: tier,
        reason: '置信度 ' + result.confidence.toFixed(2) + ' 低于阈值 ' + LOW_CONFIDENCE + '，转人工复核',
        violations: []
      };
    }
    return result;
  }

  function build_tier_notice(profile) {
    var tier = (profile || {}).tier || 'normal';
    var notices = (profile || {}).notices || [];
    var parts = [];
    notices.forEach(function (n) {
      if (n.tier === 'deny') {
        var rem = (n.remedies || []).map(function (r) { return r.label || ''; }).join('、');
        parts.push('【身份定性前置】根据' + (n.legalBasis || '相关条文') + '，该身份在法律上不产生永居路径。'
          + '合规替代路径：' + (rem || '在港工作与生活支持') + '。');
      } else if (n.tier === 'dwell') {
        parts.push((n.text || '') + '该段期间不计入，服务入口正常开放。');
      } else if (n.tier === 'cond') {
        var acts = (n.actions || []).map(function (a) { return a.label || ''; }).join('、');
        var extra = n.pendingLegalReview ? '（待法务确认，双口径并列）' : '';
        parts.push((n.text || '') + extra + '补救路径：' + (acts || '咨询专业顾问') + '。');
      }
    });
    var text = parts.join(' ');
    return text ? sanitize_tier_text(tier, text) : text;
  }

  AP.guardrails = {
    C015_REASON: C015_REASON, LOW_CONFIDENCE: LOW_CONFIDENCE, TIER_NORMS: TIER_NORMS,
    DENY_REQUIRED: DENY_REQUIRED, DENY_FORBIDDEN: DENY_FORBIDDEN,
    DWELL_FORBIDDEN: DWELL_FORBIDDEN, DWELL_REQUIRED: DWELL_REQUIRED, COND_REQUIRED: COND_REQUIRED,
    lint_text: CP.lint_text, is_evasion_request: CP.is_evasion_request,
    is_evasion_output: is_evasion_output,
    validate_tier_text: validate_tier_text, sanitize_tier_text: sanitize_tier_text,
    guard_output: guard_output, build_tier_notice: build_tier_notice
  };
})(typeof window !== 'undefined' ? window : globalThis);

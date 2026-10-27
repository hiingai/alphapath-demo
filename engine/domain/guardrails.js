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
      DWELL_FORBIDDEN.forEach(function (bad) {
        if (bad.indexOf('拦截') >= 0 || bad.indexOf('不可用') >= 0 || bad.indexOf('拒绝服务') >= 0) {
          text = text.split(bad).join('提示');
        } else {
          text = text.split(bad).join('该期间不计入');
        }
      });
      if (text.indexOf('不计入') < 0) {
        text = '该段期间不计入 7 年，服务入口正常开放。' + text;
      } else if (text.indexOf('入口') < 0 && text.indexOf('服务') < 0) {
        text = text.replace(/。+$/, '') + '。服务入口正常开放。';
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
    if (CP.is_evasion_request(text)) {
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
    validate_tier_text: validate_tier_text, sanitize_tier_text: sanitize_tier_text,
    guard_output: guard_output, build_tier_notice: build_tier_notice
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* AlphaPath · 合规红线检查（移植自 v1.4 agent/domain/compliance.py）
 * C-003 不承诺 / C-004 不网格外 / C-015 拦请求不拦身份。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});

  var FORBIDDEN_PHRASES = ['包过', '保证通过', '100% 成功', '百分百成功', '一定过', '确保获批',
    '一定计入', '一定不计入', '保证拿身份', '包成功'];
  var EVASION_PATTERNS = [
    '怎么(把|将)?(逾期|超期)(记录)?(处理掉|消除|洗白|规避)',
    '如何规避(逾期|超期)',
    '(规避|绕开|处理掉).{0,6}(逾期|超期|记录)',
    '(伪造|假).{0,6}(地址|租约|合同|流水|文书|税单)',
    '空壳|挂靠地址|虚拟地址.{0,6}(能|可以)用'
  ];
  var EVASION_RE = EVASION_PATTERNS.map(function (p) { return new RegExp(p); });

  function lint_text(text) {
    var t = text || '';
    var hits = FORBIDDEN_PHRASES.filter(function (p) { return t.indexOf(p) >= 0; });
    return { ok: hits.length === 0, hits: hits };
  }

  function is_evasion_request(text) {
    var t = text || '';
    return EVASION_RE.some(function (re) { return re.test(t); });
  }

  function check_compliance(inp) {
    inp = inp || {};
    var findings = [];
    if (!inp.applicantInHk) {
      findings.push({
        code: 'MUST_BE_IN_HK', severity: 'BLOCK',
        suggestion: '申请人须身在香港方可递交/缴费/领取电子签证。'
      });
    }
    var emp = inp.employer;
    if (emp) {
      var signals = [];
      var regMonths = emp.registeredMonths === undefined ? 99 : emp.registeredMonths;
      if (regMonths < 6) signals.push('雇主成立不足 6 个月');
      var mpfMonths = inp.mpfMonths || 0, declMonths = inp.declaredSalaryMonths || 0;
      if (mpfMonths < declMonths * 0.8) signals.push('MPF 供款期与受雇期不匹配');
      if (!emp.hasOfficeLease) signals.push('无办公地址/租约证据');
      if (signals.length) {
        findings.push({
          code: 'FAKE_EMPLOYMENT_RISK',
          severity: signals.length >= 2 ? 'BLOCK' : 'WARN',
          riskScore: Math.min(0.4 + signals.length * 0.2, 0.95), signals: signals,
          suggestion: '请补充真实经营证明，或评估改走自雇路径（需审计财报+本地职位）。',
          basisRef: 'RNW-012'
        });
      }
    }
    var se = inp.selfEmployed;
    if (se && (!se.hasAuditedAccounts || !se.hasLocalStaff)) {
      findings.push({
        code: 'SELF_EMPLOYED_WEAK', severity: 'WARN',
        suggestion: '自雇续签需业务真实营运：审计财报与本地职位证明为关键材料。',
        basisRef: 'RNW-020'
      });
    }
    var blocked = findings.some(function (f) { return f.severity === 'BLOCK'; });
    var warned = findings.some(function (f) { return f.severity === 'WARN'; });
    return {
      result: blocked ? 'BLOCK' : (warned ? 'WARN' : 'PASS'),
      findings: findings, confidence: 0.9, decision: blocked ? 'BLOCK' : 'AUTO_PASS'
    };
  }

  function guard_output(text) {
    if (is_evasion_request(text)) {
      return {
        blocked: true,
        reason: 'C-015：本平台只陈述法律事实（逾期期间不计入 7 年，其后合法期可重新起算），不提供任何规避、包装或「处理掉记录」的操作建议。',
        lint: { ok: true, hits: [] }
      };
    }
    var lint = lint_text(text);
    if (!lint.ok) {
      return {
        blocked: true,
        reason: 'C-003：检测到禁用表述 ' + lint.hits.join('、') + '，请改用「参考判断 / 存在以下风险」。',
        lint: lint
      };
    }
    return { blocked: false, lint: lint };
  }

  AP.compliance = {
    FORBIDDEN_PHRASES: FORBIDDEN_PHRASES, EVASION_PATTERNS: EVASION_PATTERNS,
    lint_text: lint_text, is_evasion_request: is_evasion_request,
    check_compliance: check_compliance, guard_output: guard_output
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* AlphaPath · 法定资格三层引擎（移植自 v1.4 agent/domain/legal.py）
 * DENY 拦服务 / DWELL 只修年限 / COND 给补救路径。只判法律事实，不判权限。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});
  var KB = global.AP_KB;

  function tier_of_identity_type(identity_type) {
    var it = KB.identityTypes[identity_type];
    return it ? it.tier : 'normal';
  }

  function legal_denials_for(applicant) {
    var it = (applicant || {}).identityType;
    if (!it) return [];
    return KB.legalBlockRules.filter(function (r) { return r.applicable.indexOf(it) >= 0; });
  }

  function legal_dwells_for(applicant) {
    var segs = (applicant || {}).segments || [];
    var kinds = {};
    segs.forEach(function (s) { if (s && s.kind) kinds[s.kind] = 1; });
    return KB.legalDwellRules.filter(function (r) { return kinds[r.condition]; });
  }

  function legal_conds_for(applicant) {
    var it = (applicant || {}).identityType;
    if (!it) return [];
    return KB.legalCondRules.filter(function (r) { return r.applicable.indexOf(it) >= 0; });
  }

  function has_legal_denial(applicant) { return legal_denials_for(applicant).length > 0; }

  function remedies(keys) {
    return (keys || []).map(function (k) {
      var base = KB.remedyActions[k] || {};
      return { key: k, label: base.label, desc: base.desc };
    });
  }

  function build_notices(tier, denials, dwells, conds) {
    var notices = [];
    if (denials.length) {
      var d = denials[0];
      var uniq = {};
      denials.forEach(function (x) { (x.remedy || []).forEach(function (k) { uniq[k] = 1; }); });
      notices.push({
        tier: 'deny', closable: false, icon: '⛔', title: '该身份在现行法律下不产生永居路径',
        text: '你在现行法律下（' + d.legal_basis + '）不产生永久性居民申请路径，本平台将把服务重定位为「在港工作与生活支持」。',
        legalBasis: d.legal_basis, ruleIds: denials.map(function (x) { return x.id; }),
        remedies: remedies(Object.keys(uniq).sort())
      });
    }
    dwells.forEach(function (d) {
      notices.push({
        tier: 'dwell', closable: false, icon: '◷', title: '期间不计入提示',
        text: d.calc_hint, ruleId: d.id, effect: d.effect,
        dualRequired: !!d.dual_required, serviceAvailable: true
      });
    });
    conds.forEach(function (c) {
      notices.push({
        tier: 'cond', closable: false, icon: '⚑', title: '条件性资格告警',
        text: c.reminder, ruleId: c.id, pendingLegalReview: !!c.pending_legal_review,
        dualBasis: c.dual_basis || null, monitor: c.monitor || null, serviceAvailable: true,
        actions: remedies(c.action)
      });
    });
    return notices;
  }

  function legal_profile_of(applicant) {
    var at = (applicant || {}).identityType;
    var it = KB.identityTypes[at];
    var tier = it ? it.tier : 'normal';
    var denials = legal_denials_for(applicant);
    var dwells = legal_dwells_for(applicant);
    var conds = legal_conds_for(applicant);
    return {
      identityType: at, tier: tier,
      canPr: it ? it.can_pr : false,
      canBringDependants: it ? it.dependants : false,
      denials: denials, dwells: dwells, conds: conds,
      notices: build_notices(tier, denials, dwells, conds, it)
    };
  }

  function has_permission(principal, service) {
    if (!principal) return true;
    var role = principal.role;
    if (role === 'platform_admin') return true;
    if (service.admin_only) return role === 'platform_admin';
    if (role === 'edu_admissions') return service.id !== 'rulebook';
    if (role === 'channel') return service.id === 'profile';
    return true;
  }

  function svc_status(principal, applicant, service) {
    var perm = has_permission(principal, service);
    var denial = has_legal_denial(applicant);
    if (!perm) return { state: '无权限', detail: '你尚无该服务的权限，可联系管理员申请。' };
    if (denial && service.blocked_by_deny) {
      return { state: '法定拦截', detail: '因法律原因不可用（见条文依据），已为你提供合规替代路径。', legal: true };
    }
    if (service.need && service.need.length) {
      var missing = service.need.filter(function (n) { return !has_permission(principal, { id: n }); });
      if (missing.length) return { state: '部分可用', detail: '部分子项需先完成：' + missing.join('、') };
    }
    return { state: '可用', detail: '' };
  }

  AP.legal = {
    tier_of_identity_type: tier_of_identity_type, legal_denials_for: legal_denials_for,
    legal_dwells_for: legal_dwells_for, legal_conds_for: legal_conds_for,
    has_legal_denial: has_legal_denial, legal_profile_of: legal_profile_of,
    has_permission: has_permission, svc_status: svc_status, _remedies: remedies
  };
})(typeof window !== 'undefined' ? window : globalThis);

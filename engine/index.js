/* AlphaPath · 引擎门面（浏览器与 Node 共用）
 * 把 v1.4 的 13 组 /api/* 收敛为本地同步/异步函数，前端 app.js 不再发 HTTP。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});

  function createAgent(opts) {
    return new AP.Agent(opts || {});
  }

  function stats(agent) { return agent ? agent.stats() : new AP.Agent().stats(); }

  var Engine = {
    version: '1.4-demo',
    ruleVersion: (global.AP_KB && global.AP_KB.meta && global.AP_KB.meta.ruleVersion) || '',
    corpusDocs: (global.AP_KB && global.AP_KB.meta && global.AP_KB.meta.corpusDocs) || 0,
    requiresKey: false,

    createAgent: createAgent,
    stats: stats,

    /* 领域能力直接透传 */
    timeline: function () { return AP.timeline; },
    legal: function () { return AP.legal; },
    compliance: function () { return AP.compliance; },
    matching: function () { return AP.matching; },
    rag: function () { return AP.rag; },
    guardrails: function () { return AP.guardrails; },

    ragQuery: function (q) { return AP.rag.rag_query_text(q); },
    ragSearch: function (q, k) { return AP.rag.rag_search(q, k); },
    legalProfile: function (identityType, segments) {
      return AP.legal.legal_profile_of({ identityType: identityType, segments: segments || [] });
    },
    timelineOf: function (identityType, activationDate) {
      return AP.timeline.compute_visa_timeline(identityType, activationDate);
    },
    dwellOf: function (segments, asOf) { return AP.timeline.compute_dwell(segments, asOf); },
    checkCompliance: function (obj) { return AP.compliance.check_compliance(obj); },
    lint: function (text) { return AP.compliance.lint_text(text); },
    guard: function (text, tier) { return AP.guardrails.guard_output(text, tier); },

    /* 设置（BYOK） */
    settings: {
      get: function () {
        return {
          hasKey: !!AP.LLMSettings.getKey(), base: AP.LLMSettings.getBase(),
          model: AP.LLMSettings.getModel()
        };
      },
      setKey: function (v, persist) { AP.LLMSettings.setKey(v, persist); },
      setBase: function (v) { AP.LLMSettings.setBase(v); },
      setModel: function (v) { AP.LLMSettings.setModel(v); },
      clear: function () { AP.LLMSettings.clear(); }
    },

    /* 能力清单（给 UI 用） */
    toolList: function () {
      var reg = new AP.ToolRegistry(null, new AP.Conductor());
      return reg.descriptions();
    }
  };

  AP.Engine = Engine;
  /* 便捷别名：UI 里直接 AP.settings.xxx */
  AP.settings = Engine.settings;
})(typeof window !== 'undefined' ? window : globalThis);

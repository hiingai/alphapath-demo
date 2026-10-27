/* AlphaPath · 本地混合检索 RAG（移植自 v1.4 agent/domain/rag.py）
 * 语料与 Python 版 _build_corpus 一一对应（89 条），每条带 citations（source/version/verifiedAt）。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});
  var KB = global.AP_KB;
  var RULE_VERSION = (KB.meta && KB.meta.ruleVersion) || 'policy.2026-10-06';

  function tokenize(text) {
    var t = String(text == null ? '' : text).toLowerCase();
    var a = t.match(/[a-z0-9]+/g) || [];
    var b = t.match(/[\u4e00-\u9fff]/g) || [];
    return a.concat(b);
  }

  function Doc(id, text, payload, embedder) {
    this.id = id;
    this.text = text;
    this.payload = payload;
    var tk = {};
    tokenize(text).forEach(function (x) { tk[x] = 1; });
    this.tokens = tk;
    this.tokenCount = Object.keys(tk).length;
    this.vec = embedder ? embedder.embed(text) : null;
  }

  function buildCorpus(embedder) {
    var docs = [];
    KB.policies.forEach(function (p) {
      var text = p.id + ' ' + p.title + ' ' + p.source + ' 政策 更新 ' + p.applicable.join(' ');
      docs.push(new Doc(p.id, text, {
        kind: 'policy', title: p.title, source: p.source, url: p.url,
        version: RULE_VERSION, verifiedAt: p.verified_at, effectiveFrom: p.effective_from,
        excerpt: p.title
      }, embedder));
    });
    KB.legalBlockRules.concat(KB.legalDwellRules, KB.legalCondRules).forEach(function (r) {
      var text = r.id + ' ' + (r.legal_basis || '') + ' ' + (r.calc_hint || '') + ' ' + (r.reminder || '')
        + ' ' + (r.condition || '') + ' ' + (r.applicable || []).join(' ') + ' 法定资格';
      docs.push(new Doc(r.id, text, {
        kind: 'legal', title: r.id, source: '《入境条例》/ 平台规则库', tier: r.tier,
        version: RULE_VERSION, verifiedAt: '2026-10-06',
        excerpt: r.legal_basis || r.calc_hint || ''
      }, embedder));
    });
    KB.complianceRedlines.forEach(function (c) {
      var desc = c.desc || c.action || '';
      var text = c.id + ' ' + c.name + ' ' + desc + ' 红线 合规 ' + String(c.action || '') + ' ' + String(c.forbidden || '');
      docs.push(new Doc(c.id, text, {
        kind: 'redline', title: c.name, source: '平台合规红线', version: RULE_VERSION,
        verifiedAt: '2026-10-06', excerpt: desc
      }, embedder));
    });
    Object.keys(KB.couplingRules).forEach(function (k) {
      var v = KB.couplingRules[k];
      docs.push(new Doc('CPL-' + k, k + ' ' + v + ' 耦合规则', {
        kind: 'coupling', title: '耦合 ' + k, source: '领域规则库', version: RULE_VERSION,
        verifiedAt: '2026-10-06', excerpt: v
      }, embedder));
    });
    Object.keys(KB.identityTypes).forEach(function (id) {
      var it = KB.identityTypes[id];
      docs.push(new Doc('IDT-' + id, id + ' ' + it.name + ' ' + (it.note || '') + ' 身份类型 签证', {
        kind: 'identity', title: it.name, source: '香港入境事务处（框架口径）',
        version: RULE_VERSION, verifiedAt: '2026-10-06', excerpt: it.note || ''
      }, embedder));
    });
    KB.schools.forEach(function (s) {
      var text = s.id + ' ' + s.name + ' ' + s.type + ' ' + s.district + ' ' + s.stage + ' '
        + s.curricula.join(' ') + ' 学校 学费 ' + (s.band || '');
      docs.push(new Doc(s.id, text, {
        kind: 'school', title: s.name, source: '学校库（框架占位）', version: RULE_VERSION,
        verifiedAt: '2026-10-06',
        excerpt: s.type + ' / ' + s.district + ' / 学费 ' + s.tuition
      }, embedder));
    });
    KB.faq.forEach(function (f) {
      docs.push(new Doc(f.id, f.id + ' ' + f.q + ' ' + f.a, {
        kind: 'faq', title: f.q, source: '平台 FAQ', version: RULE_VERSION,
        verifiedAt: '2026-10-06', excerpt: f.a
      }, embedder));
    });
    return docs;
  }

  function RAGIndex(vector_dim) {
    this.embedder = new AP.Embedder(vector_dim || 256);
    this.docs = buildCorpus(this.embedder);
  }
  RAGIndex.prototype.search = function (query, top_k) {
    top_k = top_k || 5;
    var q = String(query == null ? '' : query).trim();
    if (!q) return [];
    var qset = {};
    var qTokens = tokenize(q);
    qTokens.forEach(function (x) { qset[x] = 1; });
    var qn = Object.keys(qset).length;
    var qVec = this.embedder.embed(q);
    var scored = [];
    for (var i = 0; i < this.docs.length; i++) {
      var d = this.docs[i];
      var kw = 0.0;
      if (qn && d.tokenCount) {
        var overlap = 0;
        for (var k in qset) if (d.tokens[k]) overlap++;
        if (overlap) kw = overlap / Math.sqrt(qn * d.tokenCount);
      }
      var vec = Math.max(0, AP.Embedder.cosine(qVec, d.vec));
      if (kw === 0 && vec < 0.12) continue;
      scored.push([0.5 * vec + 0.5 * kw, d]);
    }
    scored.sort(function (a, b) { return b[0] - a[0]; });
    return scored.slice(0, top_k).map(function (x) { return x[1]; });
  };
  RAGIndex.prototype.citations = function (query, top_k) {
    return this.search(query, top_k).map(function (d) {
      var p = d.payload;
      return {
        source: p.source, version: p.version, verifiedAt: p.verifiedAt,
        id: d.id, title: p.title, kind: p.kind
      };
    });
  };

  var _INDEX = null;
  function get_index() {
    if (!_INDEX) _INDEX = new RAGIndex();
    return _INDEX;
  }

  function rag_search(query, top_k) {
    return get_index().search(query, top_k || 5).map(function (d) {
      return {
        id: d.id, kind: d.payload.kind, title: d.payload.title,
        excerpt: d.payload.excerpt || '', source: d.payload.source,
        version: d.payload.version, verifiedAt: d.payload.verifiedAt
      };
    });
  }

  function rag_query_text(query, top_k) {
    var results = get_index().search(query, top_k || 5);
    if (!results.length) return '未在本地知识库检索到与「' + query + '」直接相关的内容。';
    var lines = ['【知识库检索】关键词：' + query + '（规则版本 ' + RULE_VERSION + '）'];
    results.forEach(function (d) {
      var p = d.payload;
      lines.push('- [' + p.kind + '] ' + p.title + '：' + (p.excerpt || '') + '\n'
        + '  出处：' + p.source + '｜版本 ' + p.version + '｜最后核验 ' + p.verifiedAt);
    });
    lines.push('以上为参考判断，非审批承诺；最终以入境事务处/教育局/劳工处官方要求为准。');
    return lines.join('\n');
  }

  function coverage() {
    var idx = get_index();
    var kinds = {};
    idx.docs.forEach(function (d) { kinds[d.payload.kind] = (kinds[d.payload.kind] || 0) + 1; });
    return {
      total: idx.docs.length, kinds: kinds, rules: KB.ruleCapacity.total,
      redlines: KB.ruleCapacity.redlines, version: RULE_VERSION
    };
  }

  AP.rag = {
    RULE_VERSION: RULE_VERSION, RAGIndex: RAGIndex, get_index: get_index,
    rag_search: rag_search, rag_query_text: rag_query_text, coverage: coverage, _tokenize: tokenize
  };
})(typeof window !== 'undefined' ? window : globalThis);

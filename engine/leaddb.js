/* AlphaPath · 对话留资（Lead）
 * 把「用户在对话里说过的话」变成一条结构化客户线索：字段 → 完整度 → 意向分 → 漏斗阶段。
 *
 *   AP.Lead.syncFrom({ user, sessions, facts, consent })   // 一次同步（登录/每轮对话后）
 *   AP.Lead.all() / get(id) / put(lead) / remove(id) / clear()
 *   AP.Lead.stats(list)                                    // 后台聚合（纯函数）
 *   AP.Lead.seedDemo(n) / clearDemo()                      // 演示种子数据
 *   AP.Lead.exportJson() / exportCsv(list)                 // 导出
 *   AP.Lead._pure                                           // 纯函数（测试用）
 *
 * 存储：独立 IndexedDB 库 'alphapath_leads'（v1，store: leads），无 IDB 时退内存。
 * 隐私：contact_email 仅在用户勾选「同意联系」后写入；email_hash 只存不可逆短哈希。
 */
(function (g) {
  'use strict';
  var AP = g.AP = g.AP || {};
  var DB_NAME = 'alphapath_leads';
  var DB_VER = 1;
  var STORE = 'leads';

  var STAGES = ['visitor', 'registered', 'qualified', 'contacted', 'consulting', 'converted', 'lost'];
  var STAGE_LABEL = {
    visitor: '访客', registered: '已注册', qualified: '合格线索',
    contacted: '已联系', consulting: '跟进中', converted: '已成交', lost: '已流失'
  };
  var KEY_FIELDS = ['identityType', 'activationDate', 'dependants', 'goal'];
  var FIELD_LABEL = {
    identityType: '身份类型', activationDate: '签证激活日', dependants: '受养人',
    schoolStage: '孩子学段', goal: '主要诉求', employment: '雇佣情况'
  };
  var GOAL_LABEL = { pr: '拿永居', renewal: '续签', school: '择校 / 插班' };
  var EMP_LABEL = { 'self-employed': '自雇', employed: '受雇' };
  var FUNNEL = ['visitor', 'registered', 'qualified', 'contacted', 'consulting', 'converted'];

  /* ---------------- 小工具 ---------------- */
  function nowIso() { return new Date().toISOString(); }
  function pctNum(n, d) { return d ? Math.round((n / d) * 100) : 0; }
  function hash32(s) {           /* djb2：只用于生成稳定 id / 去重指纹，不做安全用途 */
    var h = 5381, i = 0, str = String(s || '');
    for (i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function leadId(seed) { return 'ld_' + hash32(seed || 'anon'); }
  function has(v) { return v !== undefined && v !== null && v !== ''; }

  /* ---------------- 纯函数区（Node 可直接测） ---------------- */

  /* 六维评分：身份 20 / 时间锚点 15 / 家庭复杂度 15 / 诉求强度 20 / 互动深度 15 / 可联系 15 */
  function score(f, meta) {
    f = f || {}; meta = meta || {};
    var idKey = String(f.identityType || '');
    var idScore = idKey ? (/^[A-Z]+_[ABC]$/.test(idKey) ? 20 : 10) : 0;
    var dateScore = has(f.activationDate) ? 15 : 0;
    var dep = Number(f.dependants);
    var famScore = (dep >= 1 && has(f.schoolStage)) ? 15 : (dep >= 1 ? 8 : 0);
    var goalScore = ({ pr: 20, renewal: 12, school: 10 })[f.goal] || (has(f.goal) ? 3 : 0);
    var turns = Number(meta.turns || 0), ses = Number(meta.sessions || 0);
    var engScore = (turns >= 8 && ses >= 2) ? 15 : (turns >= 4 ? 9 : (turns >= 1 ? 4 : 0));
    var conScore = (meta.consent && meta.email) ? 15 : (meta.email ? 6 : 0);
    var total = idScore + dateScore + famScore + goalScore + engScore + conScore;
    return {
      intent: Math.min(100, total),
      parts: { identity: idScore, date: dateScore, family: famScore, goal: goalScore, engage: engScore, contact: conScore }
    };
  }

  /* 完整度：4 个关键字段（身份 / 激活日 / 受养人 / 诉求） */
  function completeness(f) {
    f = f || {};
    var got = KEY_FIELDS.filter(function (k) { return has(f[k]); }).length;
    return pctNum(got, KEY_FIELDS.length);
  }

  /* 阶段：确定性晋级；人工阶段（已联系之后）不被自动回退 */
  function stageOf(o, prev) {
    var st;
    if (!o.email_hash && !o.ext_user_id) st = 'visitor';
    else if (!(o.identity_type && o.activation_date)) st = 'registered';
    else if (Number(o.intent_score) >= 50) st = 'qualified';
    else st = 'registered';
    var manual = ['contacted', 'consulting', 'converted', 'lost'];
    if (prev && manual.indexOf(prev) >= 0) return prev;   /* 人工判断优先 */
    return st;
  }

  function factRows(f, extra) {
    var out = [];
    Object.keys(f || {}).forEach(function (k) {
      if (!FIELD_LABEL[k]) return;
      if (!has(f[k])) return;
      var e = (extra || {})[k] || {};
      out.push({
        key: k, label: FIELD_LABEL[k], value: f[k],
        source: e.source || 'conversation', confidence: e.confidence === undefined ? 0.9 : e.confidence,
        evidence: e.evidence || '', updated_at: e.updatedAt || nowIso()
      });
    });
    return out;
  }

  function buildLead(input) {
    input = input || {};
    var f = input.facts || {};
    var meta = input.meta || {};
    var user = input.user || null;
    var prev = input.prev || null;
    var consent = input.consent || {};
    var email = user && user.email ? String(user.email).toLowerCase() : String(input.email || '').toLowerCase();
    var sc = score(f, { turns: meta.turns, sessions: meta.sessions, email: email, consent: !!consent.contact });
    var o = {
      id: leadId(email || (user && user.id) || 'anon'),
      ext_user_id: (user && user.id) || '',
      email_hash: email ? hash32(email) : '',
      contact_email: (consent.contact && email) ? email : null,
      contact_phone: null,
      display_name: (user && user.name) || (email ? email.split('@')[0] : '访客'),
      identity_type: has(f.identityType) ? f.identityType : null,
      activation_date: has(f.activationDate) ? f.activationDate : null,
      dependants: has(f.dependants) ? Number(f.dependants) : null,
      school_stage: has(f.schoolStage) ? f.schoolStage : null,
      goal: has(f.goal) ? f.goal : null,
      employment: has(f.employment) ? f.employment : null,
      intent_score: sc.intent,
      score_parts: sc.parts,
      completeness: completeness(f),
      stage: 'visitor',
      consent_at: (consent.contact || consent.analytics) ? (consent.at || nowIso()) : null,
      consent_scope: consent.contact && consent.analytics ? 'both' : (consent.contact ? 'contact' : (consent.analytics ? 'analytics' : null)),
      first_seen_at: meta.firstSeen || nowIso(),
      last_active_at: meta.lastActive || nowIso(),
      n_sessions: Number(meta.sessions || 0),
      n_turns: Number(meta.turns || 0),
      n_days: Number(meta.days || 1),
      summary: input.summary || (prev && prev.summary) || '',
      note: (prev && prev.note) || '',
      facts: factRows(f, input.factExtra),
      demo: false,
      created_at: (prev && prev.created_at) || nowIso(),
      updated_at: nowIso()
    };
    o.stage = stageOf(o, prev && prev.stage);
    return o;
  }

  /* 会话统计：轮次 / 会话数 / 首次-最近活跃 / 活跃天数 */
  function metaFromSessions(sessions) {
    var turns = 0, ses = 0, first = null, last = null, days = {};
    (sessions || []).forEach(function (s) {
      var msgs = (s && s.msgs) || [];
      if (msgs.length) ses++;
      msgs.forEach(function (m) {
        if (m && m.role === 'user') turns++;
        var t = (m && m.at) || (s && s.at);
        if (!t) return;
        if (first === null || t < first) first = t;
        if (last === null || t > last) last = t;
        try { days[new Date(t).toISOString().slice(0, 10)] = 1; } catch (e) { }
      });
    });
    return {
      turns: turns, sessions: ses,
      firstSeen: first ? new Date(first).toISOString() : null,
      lastActive: last ? new Date(last).toISOString() : null,
      days: Object.keys(days).length || 1
    };
  }

  /* 聚合（后台首屏用；纯函数，输入 leads 数组） */
  function stats(list) {
    list = list || [];
    var byStage = {}, byIdentity = {}, byGoal = {}, bySchool = {}, trend = {};
    var sumScore = 0, sumComp = 0, sumTurns = 0, hot = 0, lead = 0, consent = 0, withContact = 0;
    STAGES.forEach(function (s) { byStage[s] = 0; });
    list.forEach(function (l) {
      byStage[l.stage] = (byStage[l.stage] || 0) + 1;
      var ik = l.identity_type || 'unknown';
      byIdentity[ik] = (byIdentity[ik] || 0) + 1;
      var gk = l.goal || 'unknown';
      byGoal[gk] = (byGoal[gk] || 0) + 1;
      var sk = l.school_stage || 'unknown';
      bySchool[sk] = (bySchool[sk] || 0) + 1;
      sumScore += Number(l.intent_score || 0);
      sumComp += Number(l.completeness || 0);
      sumTurns += Number(l.n_turns || 0);
      if (Number(l.intent_score || 0) >= 70) hot++;
      if (Number(l.completeness || 0) >= 75) lead++;      /* 留资：关键字段 ≥3/4 */
      if (l.consent_at) consent++;
      if (l.contact_email) withContact++;
      var day = String(l.created_at || '').slice(0, 10);
      if (day) trend[day] = (trend[day] || 0) + 1;
    });
    var n = list.length;
    return {
      n: n, byStage: byStage, byIdentity: byIdentity, byGoal: byGoal, bySchool: bySchool,
      trend: Object.keys(trend).sort().slice(-30).map(function (d) { return { day: d, n: trend[d] }; }),
      avgScore: n ? Math.round(sumScore / n) : 0,
      avgComp: n ? Math.round(sumComp / n) : 0,
      avgTurns: n ? Math.round((sumTurns / n) * 10) / 10 : 0,
      hot: hot, leadCount: lead,
      leadRate: pctNum(lead, n),
      qualificationRate: pctNum((byStage.qualified || 0) + (byStage.contacted || 0) + (byStage.consulting || 0) + (byStage.converted || 0), n),
      consentRate: pctNum(withContact, n),
      funnel: FUNNEL.map(function (s) { return { stage: s, label: STAGE_LABEL[s], n: byStage[s] || 0 }; })
    };
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    var cols = [
      ['display_name', '称呼'], ['identity_type', '身份类型'], ['activation_date', '激活日'],
      ['dependants', '受养人'], ['school_stage', '孩子学段'], ['goal', '主要诉求'],
      ['employment', '雇佣'], ['completeness', '完整度%'], ['intent_score', '意向分'],
      ['stage', '阶段'], ['n_sessions', '会话数'], ['n_turns', '轮次'],
      ['contact_email', '邮箱（同意后）'], ['first_seen_at', '首次'], ['last_active_at', '最近活跃'],
      ['summary', '摘要'], ['note', '跟进备注'], ['demo', '演示数据']
    ];
    var head = cols.map(function (c) { return csvCell(c[1]); }).join(',');
    var body = (rows || []).map(function (r) {
      return cols.map(function (c) { return csvCell(r[c[0]]); }).join(',');
    });
    return '\ufeff' + [head].concat(body).join('\r\n');
  }

  /* ---------------- 存储层 ---------------- */
  function memApi() {
    var data = {};
    return {
      kind: 'memory',
      ready: function () { return Promise.resolve(true); },
      all: function () { return Promise.resolve(Object.keys(data).map(function (k) { return data[k]; })); },
      get: function (id) { return Promise.resolve(data[id] || null); },
      put: function (o) { data[o.id] = JSON.parse(JSON.stringify(o)); return Promise.resolve(o); },
      del: function (id) { delete data[id]; return Promise.resolve(true); },
      clear: function () { data = {}; return Promise.resolve(true); }
    };
  }

  function idbApi() {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res, rej) {
        var r = g.indexedDB.open(DB_NAME, DB_VER);
        r.onupgradeneeded = function () {
          var db = r.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var s = db.createObjectStore(STORE, { keyPath: 'id' });
            s.createIndex('stage', 'stage', { unique: false });
          }
        };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error || new Error('LEAD_IDB_OPEN')); };
      });
      return dbp;
    }
    function store(mode) {
      return open().then(function (db) { return db.transaction(STORE, mode).objectStore(STORE); });
    }
    function wrap(req) {
      return new Promise(function (res, rej) {
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
    }
    return {
      kind: 'idb',
      ready: function () { return open().then(function () { return true; }, function () { return false; }); },
      all: function () { return store('readonly').then(function (s) { return wrap(s.getAll()); }); },
      get: function (id) { return store('readonly').then(function (s) { return wrap(s.get(id)); }); },
      put: function (o) { return store('readwrite').then(function (s) { return wrap(s.put(o)).then(function () { return o; }); }); },
      del: function (id) { return store('readwrite').then(function (s) { return wrap(s.delete(id)); }); },
      clear: function () { return store('readwrite').then(function (s) { return wrap(s.clear()); }); }
    };
  }

  var _api = null;
  function api() {
    if (_api) return _api;
    if (!g.indexedDB) { _api = memApi(); return _api; }
    var idb = idbApi();
    _api = {
      kind: 'idb',
      ready: function () { return idb.ready().then(function (ok) { if (!ok) { _api = memApi(); return _api.ready(); } return true; }); },
      all: function () { return idb.all().catch(function () { return memApi().all(); }); },
      get: function (id) { return idb.get(id).catch(function () { return null; }); },
      put: function (o) { return idb.put(o).catch(function () { return o; }); },
      del: function (id) { return idb.del(id).catch(function () { return true; }); },
      clear: function () { return idb.clear().catch(function () { return true; }); }
    };
    return _api;
  }

  /* ---------------- 演示种子数据（确定性，全虚构） ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var DEMO_IDENT = ['TTPS_A', 'TTPS_B', 'TTPS_B', 'TTPS_C', 'QMAS', 'ASMTP', 'IANG', 'TTPS_B', 'QMAS', 'TTPS_A'];
  var DEMO_STAGE = ['visitor', 'registered', 'qualified', 'qualified', 'contacted', 'consulting', 'converted', 'registered', 'lost', 'qualified'];
  var DEMO_SCHOOL = ['中二', '小四', '中一', '小六', '中三', ''];
  var DEMO_GOAL = ['pr', 'pr', 'school', 'renewal', 'pr', 'school', 'pr', 'renewal', 'pr', 'school'];
  var DEMO_NAMES = ['陈先生', '李太', 'Wong 先生', '张女士', '周先生', '何太', '林先生', '吳女士', '梁先生', '鄭太', '許先生', '曾女士'];

  function seedDemo(n) {
    n = Number(n) || 36;
    var rnd = mulberry32(20261030);
    var now = Date.now(), out = [];
    for (var i = 0; i < n; i++) {
      var ident = DEMO_IDENT[Math.floor(rnd() * DEMO_IDENT.length)];
      var goal = DEMO_GOAL[Math.floor(rnd() * DEMO_GOAL.length)];
      var dep = rnd() < 0.55 ? 1 + Math.floor(rnd() * 3) : null;
      var school = dep ? DEMO_SCHOOL[Math.floor(rnd() * (DEMO_SCHOOL.length - 1))] : null;
      var daysAgo = Math.floor(rnd() * 44);
      var created = new Date(now - daysAgo * 86400000 - Math.floor(rnd() * 8) * 3600000);
      var turns = 1 + Math.floor(rnd() * 14);
      var ses = turns > 6 ? 2 : 1;
      var consent = rnd() < 0.62;
      var email = 'demo' + (100 + i) + '@example.com';
      var f = { identityType: rnd() < 0.92 ? ident : null, activationDate: rnd() < 0.8 ? ('2025-0' + (1 + Math.floor(rnd() * 9)) + '-0' + (1 + Math.floor(rnd() * 9))) : null, goal: rnd() < 0.9 ? goal : null };
      if (dep) f.dependants = dep;
      if (school) f.schoolStage = school;
      if (rnd() < 0.4) f.employment = rnd() < 0.5 ? 'self-employed' : 'employed';
      var sc = score(f, { turns: turns, sessions: ses, email: email, consent: consent });
      var name = DEMO_NAMES[i % DEMO_NAMES.length];
      var l = {
        id: 'ld_demo' + (1000 + i),
        ext_user_id: 'usr_demo' + (1000 + i),
        email_hash: hash32(email),
        contact_email: consent ? email : null,
        contact_phone: null,
        display_name: name,
        identity_type: f.identityType || null,
        activation_date: f.activationDate || null,
        dependants: f.dependants || null,
        school_stage: f.schoolStage || null,
        goal: f.goal || null,
        employment: f.employment || null,
        intent_score: sc.intent,
        score_parts: sc.parts,
        completeness: completeness(f),
        stage: DEMO_STAGE[i % DEMO_STAGE.length],
        consent_at: consent ? created.toISOString() : null,
        consent_scope: consent ? 'contact' : null,
        first_seen_at: created.toISOString(),
        last_active_at: new Date(created.getTime() + Math.floor(rnd() * 6) * 86400000).toISOString(),
        n_sessions: ses, n_turns: turns, n_days: Math.min(5, 1 + Math.floor(turns / 3)),
        summary: [f.identityType ? '身份已明确' : '身份待确认', f.activationDate ? '激活日已知' : '缺激活日', dep ? '带 ' + dep + ' 名受养人' + (school ? '（' + school + '）' : '') : '暂未提受养人', '诉求：' + (GOAL_LABEL[f.goal] || '待确认')].join('；'),
        note: '', facts: factRows(f), demo: true,
        created_at: created.toISOString(), updated_at: created.toISOString()
      };
      out.push(l);
    }
    return api().all().then(function (existing) {
      var keep = existing.filter(function (x) { return !x.demo; });
      return Promise.all(out.map(function (l) { return api().put(l); })).then(function () {
        return { added: out.length, total: keep.length + out.length };
      });
    });
  }

  /* ---------------- 对外 API ---------------- */
  var L = {
    STAGES: STAGES, STAGE_LABEL: STAGE_LABEL, FUNNEL: FUNNEL,
    FIELD_LABEL: FIELD_LABEL, KEY_FIELDS: KEY_FIELDS, GOAL_LABEL: GOAL_LABEL, EMP_LABEL: EMP_LABEL,
    ready: function () { return api().ready(); },
    adapterKind: function () { return api().kind; },
    all: function () { return api().all().then(function (l) { return l.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); }); }); },
    get: function (id) { return api().get(id); },
    put: function (o) { o.updated_at = nowIso(); return api().put(o); },
    remove: function (id) { return api().del(id); },
    clear: function () { return api().clear(); },

    /* 主入口：从档案 + 会话同步出一条线索 */
    syncFrom: function (opts) {
      opts = opts || {};
      var meta = opts.meta || metaFromSessions(opts.sessions);
      var emailLc = String((opts.user && opts.user.email) || '').toLowerCase();
      var id = leadId(emailLc || (opts.user && opts.user.id) || 'anon');
      return api().get(id).then(function (prev) {
        var lead = buildLead({
          user: opts.user, facts: opts.facts || {}, meta: meta,
          consent: opts.consent || {}, prev: prev, summary: opts.summary,
          factExtra: opts.factExtra || {}
        });
        return api().put(lead).then(function () { return lead; });
      });
    },
    buildLead: buildLead, stats: stats, metaFromSessions: metaFromSessions,
    toCsv: toCsv, seedDemo: seedDemo,
    clearDemo: function () {
      return api().all().then(function (list) {
        return Promise.all(list.filter(function (l) { return l.demo; }).map(function (l) { return api().del(l.id); }));
      }).then(function () { return true; });
    },
    clearMine: function (extId) {
      return api().all().then(function (list) {
        return Promise.all(list.filter(function (l) { return l.ext_user_id === extId; }).map(function (l) { return api().del(l.id); }));
      }).then(function () { return true; });
    },
    exportJson: function (list) {
      return JSON.stringify({ exportedAt: nowIso(), build: (AP.BUILD || ''), leads: list || [] }, null, 2);
    },
    _pure: {
      score: score, completeness: completeness, stageOf: stageOf, buildLead: buildLead,
      metaFromSessions: metaFromSessions, stats: stats, toCsv: toCsv, hash32: hash32, leadId: leadId,
      factRows: factRows
    }
  };
  AP.Lead = L;
})(typeof window !== 'undefined' ? window : globalThis);

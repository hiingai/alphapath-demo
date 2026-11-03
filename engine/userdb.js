/* AlphaPath · 用户数据库（轻量）
 * 设计目标：现在能纯前端跑（IndexedDB），将来接后端时只换 adapter，不改调用方。
 *
 *   AP.DB.store    —— 底层存储适配器（idb / memory / local）
 *   AP.DB.auth     —— 邮箱注册/登录（PBKDF2 派生，绝不存明文）+ 手机/微信 mock 预留
 *   AP.DB.profile  —— 用户档案（身份类型、激活日、受养人…），可从对话/记忆自动学习
 *
 * IndexedDB 结构（v1）：
 *   users    { id, email, emailLower, name, pw: {algo, iter, salt, hash}, createdAt, providers: {phone, wechat} }
 *   facts    { id, userId, key, value, confidence, source, updatedAt, superseded }  key = userId + '|' + key
 *   turns    { id, userId, sessionId, at, userText, replyDigest }
 */
(function (g) {
  'use strict';
  var AP = g.AP = g.AP || {};
  var DB_NAME = 'alphapath';
  var DB_VER = 1;
  var STORES = ['users', 'facts', 'turns'];

  /* ---------------- 适配器：内存（测试）/ IndexedDB（浏览器） ---------------- */
  function memoryAdapter() {
    var data = {};
    STORES.forEach(function (s) { data[s] = {}; });
    return {
      kind: 'memory',
      ready: function () { return Promise.resolve(true); },
      put: function (store, obj) { data[store][obj.id] = JSON.parse(JSON.stringify(obj)); return Promise.resolve(obj); },
      get: function (store, id) { return Promise.resolve(data[store][id] ? JSON.parse(JSON.stringify(data[store][id])) : null); },
      del: function (store, id) { delete data[store][id]; return Promise.resolve(true); },
      all: function (store) { return Promise.resolve(Object.keys(data[store]).map(function (k) { return JSON.parse(JSON.stringify(data[store][k])); })); },
      clear: function () { STORES.forEach(function (s) { data[s] = {}; }); return Promise.resolve(true); }
    };
  }

  function idbAdapter() {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        var req = g.indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('users')) {
            var u = db.createObjectStore('users', { keyPath: 'id' });
            u.createIndex('emailLower', 'emailLower', { unique: true });
          }
          if (!db.objectStoreNames.contains('facts')) {
            var f = db.createObjectStore('facts', { keyPath: 'id' });
            f.createIndex('userId', 'userId', { unique: false });
          }
          if (!db.objectStoreNames.contains('turns')) {
            var t = db.createObjectStore('turns', { keyPath: 'id' });
            t.createIndex('userId', 'userId', { unique: false });
          }
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('IDB_OPEN_FAILED')); };
      });
      return dbp;
    }
    function tx(store, mode) {
      return open().then(function (db) {
        return db.transaction(store, mode).objectStore(store);
      });
    }
    function wrap(req) {
      return new Promise(function (res, rej) {
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { rej(req.error); };
      });
    }
    return {
      kind: 'idb',
      ready: function () { return open().then(function () { return true; }); },
      put: function (store, obj) { return tx(store, 'readwrite').then(function (s) { return wrap(s.put(obj)).then(function () { return obj; }); }); },
      get: function (store, id) { return tx(store, 'readonly').then(function (s) { return wrap(s.get(id)); }).then(function (v) { return v || null; }); },
      del: function (store, id) { return tx(store, 'readwrite').then(function (s) { return wrap(s.delete(id)); }).then(function () { return true; }); },
      all: function (store) { return tx(store, 'readonly').then(function (s) { return wrap(s.getAll()); }).then(function (v) { return v || []; }); },
      clear: function () {
        return open().then(function (db) {
          return Promise.all(STORES.map(function (n) {
            return new Promise(function (res, rej) {
              var r = db.transaction(n, 'readwrite').objectStore(n).clear();
              r.onsuccess = function () { res(true); }; r.onerror = function () { rej(r.error); };
            });
          }));
        });
      }
    };
  }

  function pickAdapter(opt) {
    if (opt && opt.adapter) return opt.adapter;
    if (g.indexedDB) { try { return idbAdapter(); } catch (e) { /* 隐私模式等 */ } }
    return memoryAdapter();
  }

  /* ---------------- 口令派生（PBKDF2-SHA256，绝不落明文） ---------------- */
  var PBKDF2_ITER = 120000;
  function toHex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function randomSalt() {
    var a = new Uint8Array(16);
    if (g.crypto && g.crypto.getRandomValues) g.crypto.getRandomValues(a);
    else for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    return toHex(a);
  }
  /* 无 crypto.subtle 时的降级实现（仅 Node 测试/极老浏览器）：单次 SHA-256 + 迭代加盐，
   * 比明文强，但强度不及 PBKDF2——浏览器里永远走 PBKDF2。 */
  function sha256_hex(str) {
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
      else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var k = 7; k >= 0; k--) bytes.push((bitLen / Math.pow(2, k * 8)) & 255);
    for (var off = 0; off < bytes.length; off += 64) {
      var w = new Array(64);
      for (var j = 0; j < 16; j++) {
        w[j] = (bytes[off + j * 4] << 24) | (bytes[off + j * 4 + 1] << 16) | (bytes[off + j * 4 + 2] << 8) | bytes[off + j * 4 + 3];
      }
      for (j = 16; j < 64; j++) {
        var s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        var s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], gg = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        var ch = (e & f) ^ (~e & gg);
        var t1 = (h + S1 + ch + K[j] + w[j]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        var maj = (a & b) ^ (a & cc) ^ (b & cc);
        var t2 = (S0 + maj) | 0;
        h = gg; gg = f; f = e; e = (d + t1) | 0;
        d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + gg) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  function derive(password, saltHex, iter) {
    var subtle = g.crypto && g.crypto.subtle;
    if (!subtle) {
      /* 降级：salt + 迭代哈希，至少保证「不同密码 → 不同摘要」 */
      var acc = saltHex + '|' + String(password);
      var rounds = Math.min(2000, Math.max(50, Math.floor((iter || PBKDF2_ITER) / 100)));
      for (var i = 0; i < rounds; i++) acc = sha256_hex(acc + '|' + saltHex + '|' + i);
      return Promise.resolve('sha256$' + rounds + '$' + acc);
    }
    var enc = new TextEncoder();
    var salt = new Uint8Array(saltHex.match(/../g).map(function (h) { return parseInt(h, 16); }));
    return subtle.importKey('raw', enc.encode(String(password)), { name: 'PBKDF2' }, false, ['deriveBits'])
      .then(function (k) { return subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iter || PBKDF2_ITER, hash: 'SHA-256' }, k, 256); })
      .then(toHex);
  }

  function uid(prefix) {
    return (prefix || 'u') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function normEmail(e) { return String(e || '').trim().toLowerCase(); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(normEmail(e)); }

  /* ---------------- 认证 ---------------- */
  var SESSION_KEY = 'ap:auth:token';
  var CURRENT_KEY = 'ap:auth:user';

  function auth(adapter) {
    var A = {
      adapter: adapter,
      loginModes: function () {
        return [
          { id: 'email', label: '邮箱 + 密码', enabled: true, note: '本机注册，密码经 PBKDF2 派生后只存摘要' },
          { id: 'phone', label: '手机号验证码', enabled: false, note: '预留接口：接短信服务商后开启' },
          { id: 'wechat', label: '微信登录', enabled: false, note: '预留接口：接微信开放平台后开启' }
        ];
      },
      current: function () {
        var raw = null;
        try { raw = g.localStorage ? g.localStorage.getItem(CURRENT_KEY) : null; } catch (e) { raw = null; }
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
      },
      register: function (email, password, name) {
        var em = normEmail(email);
        if (!validEmail(em)) return Promise.reject(new Error('邮箱格式不对'));
        if (String(password || '').length < 8) return Promise.reject(new Error('密码至少 8 位'));
        return A.findByEmail(em).then(function (dup) {
          if (dup) throw new Error('这个邮箱已经注册过了，直接登录吧');
          var salt = randomSalt();
          return derive(password, salt).then(function (hash) {
            var user = {
              id: uid('usr_'), email: em, emailLower: em, name: (name || '').trim() || em.split('@')[0],
              pw: { algo: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: salt, hash: hash },
              providers: { phone: null, wechat: null },
              createdAt: new Date().toISOString()
            };
            return adapter.put('users', user).then(function () { return A._settle(user); });
          });
        });
      },
      login: function (email, password) {
        var em = normEmail(email);
        return A.findByEmail(em).then(function (user) {
          if (!user) throw new Error('没找到这个邮箱，先注册');
          return derive(password, user.pw.salt, user.pw.iter).then(function (hash) {
            if (hash !== user.pw.hash) throw new Error('密码不对');
            return A._settle(user);
          });
        });
      },
      /* 预留：手机号 / 微信。真接的时候把 body 换成对应的 OAuth/短信校验，其余逻辑不动。 */
      loginWithPhone: function (phone, code) {
        return Promise.reject(Object.assign(new Error('手机号登录尚未开放（接口已预留）'), { code: 'NOT_ENABLED', mode: 'phone', mock: { phone: phone, code: code } }));
      },
      loginWithWeChat: function (payload) {
        return Promise.reject(Object.assign(new Error('微信登录尚未开放（接口已预留）'), { code: 'NOT_ENABLED', mode: 'wechat', mock: payload || {} }));
      },
      logout: function () {
        try { if (g.localStorage) { g.localStorage.removeItem(SESSION_KEY); g.localStorage.removeItem(CURRENT_KEY); } } catch (e) { /* ignore */ }
        return Promise.resolve(true);
      },
      findByEmail: function (em) {
        return adapter.all('users').then(function (list) {
          for (var i = 0; i < list.length; i++) if (list[i].emailLower === em) return list[i];
          return null;
        });
      },
      _settle: function (user) {
        var safe = { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, providers: user.providers };
        try {
          if (g.localStorage) {
            g.localStorage.setItem(CURRENT_KEY, JSON.stringify(safe));
            g.localStorage.setItem(SESSION_KEY, 'local-' + user.id);
          }
        } catch (e) { /* 配额满也不影响登录 */ }
        return safe;
      }
    };
    return A;
  }

  /* ---------------- 档案（facts）：单一事实表，改了就覆盖旧的 ---------------- */
  var FACT_DEFS = {
    identityType: { label: '身份类型', weight: 1 },
    activationDate: { label: '签证激活日', weight: 1 },
    dependants: { label: '受养人', weight: 0.7 },
    schoolStage: { label: '孩子学段', weight: 0.5 },
    employment: { label: '雇佣情况', weight: 0.5 },
    goal: { label: '主要诉求', weight: 0.5 }
  };

  function profile(adapter, authApi) {
    function userId() {
      var u = authApi.current();
      return u ? u.id : 'local';
    }
    var P = {
      defs: FACT_DEFS,
      userId: userId,
      all: function () {
        var uidv = userId();
        return adapter.all('facts').then(function (list) {
          return list.filter(function (f) { return f.userId === uidv && !f.superseded; })
            .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
        });
      },
      get: function () {
        return P.all().then(function (list) {
          var o = {};
          list.forEach(function (f) { if (o[f.key] === undefined) o[f.key] = f.value; });
          return o;
        });
      },
      set: function (key, value, source) {
        if (!key) return Promise.reject(new Error('缺少 key'));
        if (value === undefined || value === null || value === '') return P.clear(key);
        var uidv = userId();
        var id = uidv + '|' + key;
        return adapter.all('facts').then(function (list) {
          var prev = list.filter(function (f) { return f.userId === uidv && f.key === key && !f.superseded; })[0];
          if (prev && String(prev.value) === String(value)) {
            prev.updatedAt = new Date().toISOString();
            return adapter.put('facts', prev).then(function () { return prev; });
          }
          var fact = {
            id: id, userId: uidv, key: key, value: value,
            confidence: 1, source: source || 'user',
            updatedAt: new Date().toISOString(), superseded: false,
            history: (prev && prev.history ? prev.history : []).concat(prev ? [{ value: prev.value, at: prev.updatedAt }] : []).slice(-8)
          };
          return adapter.put('facts', fact).then(function () { return fact; });
        });
      },
      clear: function (key) {
        var uidv = userId();
        return adapter.all('facts').then(function (list) {
          var mine = list.filter(function (f) { return f.userId === uidv && (!key || f.key === key); });
          return Promise.all(mine.map(function (f) {
            f.superseded = true; f.updatedAt = new Date().toISOString();
            return adapter.put('facts', f);
          }));
        });
      },
      /* 从一段话里抽事实（确定性规则，不用模型） */
      extract: function (text) {
        var t = String(text || '');
        var out = {};
        var ident = (AP.Agent && AP.Agent.detect_identity) ? AP.Agent.detect_identity(t) : null;
        if (ident) out.identityType = ident;
        var d = (AP.Agent && AP.Agent._detect_date) ? AP.Agent._detect_date(t) : null;
        if (d) out.activationDate = d;
        var CN = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5 };
        var m = t.match(/([1-5一二两三四五])\s*(?:个|名)?\s*(?:孩子|小朋友|子女|仔女|小孩)/);
        if (m) out.dependants = CN[m[1]] || parseInt(m[1], 10);
        if (/(中一|中二|中三|中四|中五|中六|初中|高中|DSE)/.test(t)) out.schoolStage = (t.match(/(中[一二三四五六]|初中|高中|DSE)/) || [''])[0];
        else if (/(小学|小一|小二|小四|小五|小六)/.test(t)) out.schoolStage = (t.match(/(小[一二三四五六])/) || ['小学'])[0];
        if (/(自雇|自己开公司|老板|创业)/.test(t)) out.employment = 'self-employed';
        else if (/(受雇|打工|上班|公司职员)/.test(t)) out.employment = 'employed';
        if (/(永居|永久居民)/.test(t)) out.goal = 'pr';
        else if (/(续签)/.test(t)) out.goal = 'renewal';
        else if (/(择校|学校|学位|插班)/.test(t)) out.goal = 'school';
        return out;
      },
      /* 从对话文本学习（每轮调用；只写有变化的） */
      learn: function (text, source) {
        var picked = P.extract(text);
        var keys = Object.keys(picked);
        return Promise.all(keys.map(function (k) { return P.set(k, picked[k], source || 'conversation'); }))
          .then(function () { return picked; });
      },
      /* 从历史对话记录 + 长期记忆批量重建（用户点「从对话重建档案」） */
      rebuild: function (sessions, memories) {
        var texts = [];
        (sessions || []).forEach(function (s) {
          (s.msgs || []).forEach(function (m) { if (m.role === 'user' && m.text) texts.push(m.text); });
        });
        (memories || []).forEach(function (m) { if (m && m.content) texts.push(m.content); });
        /* 按时间顺序学习，后面的覆盖前面的（改口以最新为准） */
        return texts.reduce(function (p, t) { return p.then(function () { return P.learn(t, 'rebuild'); }); }, Promise.resolve())
          .then(function () { return P.get(); });
      },
      /* 供对话注入：把档案压成一段可读上下文 */
      asContext: function () {
        return P.get().then(function (o) {
          var lines = Object.keys(o).filter(function (k) { return FACT_DEFS[k]; }).map(function (k) {
            var v = o[k];
            if (k === 'identityType' && AP_KB && AP_KB.identityTypes && AP_KB.identityTypes[v]) v = AP_KB.identityTypes[v].name;
            if (k === 'employment') v = v === 'self-employed' ? '自雇' : '受雇';
            return '- ' + FACT_DEFS[k].label + '：' + v;
          });
          return lines.length ? '【用户档案（来自历史对话，可能过时）】\n' + lines.join('\n') : '';
        });
      }
    };
    return P;
  }

  /* ---------------- 组装 ---------------- */
  function create(opt) {
    var adapter = pickAdapter(opt);
    var authApi = auth(adapter);
    var profApi = profile(adapter, authApi);
    return {
      adapter: adapter,
      auth: authApi,
      profile: profApi,
      ready: function () { return adapter.ready(); },
      reset: function () { return adapter.clear(); }
    };
  }

  AP.DB = {
    create: create,
    memoryAdapter: memoryAdapter,
    DB_NAME: DB_NAME,
    FACT_DEFS: FACT_DEFS,
    /* 页面默认实例：浏览器用 IndexedDB，没有就退内存 */
    _inst: null,
    get: function () {
      if (!AP.DB._inst) AP.DB._inst = create({});
      return AP.DB._inst;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

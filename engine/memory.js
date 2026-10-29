/* AlphaPath · 三层记忆（移植自 v1.4 agent/memory.py）
 * 短期（滚动窗口，绝不切断 tool 配对）/ 工作（草稿纸）/ 长期（情景·语义·程序）
 * 浏览器持久化：localStorage（可用则用），键前缀 ap:mem:
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});
  var CFG = {
    SHORT_TERM_MAX_TURNS: 10, MEMORY_CAPACITY: 500, RETRIEVE_TOP_K: 5,
    AUTO_SAVE: true, AUTO_SAVE_EVERY_N_TURNS: 3, AUTO_SAVE_ON_OVERFLOW: true,
    DEDUP_ENABLED: true, DEDUP_THRESHOLD: 0.8, DEDUP_STRATEGY: 'merge',
    VECTOR_ENABLED: true, VECTOR_DIM: 256, VECTOR_WEIGHT: 0.5, KEYWORD_WEIGHT: 0.5,
    MAX_TOOL_ROUNDS: 8
  };

  var Store = (function () {
    var mem = {};
    var ls = null;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('__ap_probe', '1');
        localStorage.removeItem('__ap_probe');
        ls = localStorage;
      }
    } catch (e) { ls = null; }
    return {
      persistent: !!ls,
      get: function (k) { try { return ls ? ls.getItem(k) : (mem[k] === undefined ? null : mem[k]); } catch (e) { return mem[k] || null; } },
      set: function (k, v) { try { if (ls) ls.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } },
      del: function (k) { try { if (ls) ls.removeItem(k); else delete mem[k]; } catch (e) { delete mem[k]; } }
    };
  })();

  function nowISO() { return new Date().toISOString(); }
  function uid() {
    var s = '';
    for (var i = 0; i < 12; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  }
  function tokenize(text) {
    var t = String(text == null ? '' : text).toLowerCase();
    return (t.match(/[a-z0-9]+/g) || []).concat(t.match(/[\u4e00-\u9fff]/g) || []);
  }

  function MemoryItem(kw) {
    kw = kw || {};
    this.id = kw.id || ('mem_' + uid());
    this.type = kw.type || 'episodic';
    this.content = kw.content || '';
    this.summary = kw.summary || (kw.content || '').slice(0, 50);
    this.tags = kw.tags || [];
    this.source = kw.source || '';
    this.created_at = kw.created_at || nowISO();
    this.updated_at = kw.updated_at || this.created_at;
    this.last_accessed_at = kw.last_accessed_at || this.created_at;
    this.access_count = kw.access_count || 0;
    this.importance = kw.importance === undefined ? 0.5 : kw.importance;
    this.confidence = kw.confidence === undefined ? 0.8 : kw.confidence;
    this.status = kw.status || 'active';
  }
  MemoryItem.prototype.to_dict = function () {
    return JSON.parse(JSON.stringify(this));
  };
  MemoryItem.from_dict = function (d) {
    var o = {};
    Object.keys(d || {}).forEach(function (k) { if (k !== '_embedding' && k !== 'to_dict') o[k] = d[k]; });
    return new MemoryItem(o);
  };

  /* ---------------- 短期记忆 ---------------- */
  function ShortTermMemory(max_turns, on_overflow) {
    this.max_turns = parseInt(max_turns || CFG.SHORT_TERM_MAX_TURNS, 10);
    this.messages = [];
    this.on_overflow = on_overflow || null;
  }
  ShortTermMemory.HARD_CAP_FACTOR = 8;
  ShortTermMemory.prototype.add = function (role, content, extra) {
    var msg = { role: role, content: content };
    if (extra) Object.keys(extra).forEach(function (k) { msg[k] = extra[k]; });
    this.add_message(msg);
  };
  ShortTermMemory.prototype.add_message = function (message) {
    var copy = {};
    Object.keys(message).forEach(function (k) { copy[k] = message[k]; });
    this.messages.push(copy);
    this._trim();
  };
  ShortTermMemory.prototype._trim = function () {
    var overflow = [];
    var self = this;
    var userIdx = [];
    this.messages.forEach(function (m, i) { if (m.role === 'user') userIdx.push(i); });
    if (userIdx.length > this.max_turns) {
      var cut = this._safe_cut(userIdx[userIdx.length - this.max_turns]);
      overflow = overflow.concat(this.messages.slice(0, cut));
      this.messages = this.messages.slice(cut);
    }
    var hardCap = this.max_turns * ShortTermMemory.HARD_CAP_FACTOR;
    if (this.messages.length > hardCap) {
      var cut2 = this._safe_cut(this.messages.length - hardCap);
      overflow = overflow.concat(this.messages.slice(0, cut2));
      this.messages = this.messages.slice(cut2);
    }
    if (this.on_overflow && overflow.length) {
      try { this.on_overflow(overflow); } catch (e) { /* 忽略 */ }
    }
  };
  ShortTermMemory.prototype._safe_cut = function (cut) {
    cut = Math.max(0, Math.min(cut, this.messages.length));
    while (cut < this.messages.length && this.messages[cut].role === 'tool') cut++;
    while (cut < this.messages.length && this.messages[cut].tool_calls) cut++;
    return cut;
  };
  ShortTermMemory.prototype.get = function () { return this.messages.slice(); };
  ShortTermMemory.prototype.turns = function () {
    return this.messages.filter(function (m) { return m.role === 'user'; }).length;
  };
  ShortTermMemory.prototype.clear = function () { this.messages = []; };

  /* ---------------- 工作记忆 ---------------- */
  function WorkingMemory() { this.state = {}; }
  WorkingMemory.prototype.set = function (k, v) { this.state[k] = v; };
  WorkingMemory.prototype.get = function (k, d) { return this.state[k] === undefined ? (d === undefined ? null : d) : this.state[k]; };
  WorkingMemory.prototype.to_dict = function () { return JSON.parse(JSON.stringify(this.state)); };
  WorkingMemory.prototype.clear = function () { this.state = {}; };

  /* ---------------- 长期记忆 ---------------- */
  var PREFIX = 'ap:mem:';
  function LongTermMemory(opts) {
    opts = opts || {};
    this.capacity = opts.capacity || CFG.MEMORY_CAPACITY;
    this.dedup_enabled = opts.dedup_enabled === undefined ? CFG.DEDUP_ENABLED : opts.dedup_enabled;
    this.dedup_threshold = opts.dedup_threshold === undefined ? CFG.DEDUP_THRESHOLD : opts.dedup_threshold;
    this.dedup_strategy = opts.dedup_strategy || CFG.DEDUP_STRATEGY;
    this.vector_enabled = opts.vector_enabled === undefined ? CFG.VECTOR_ENABLED : opts.vector_enabled;
    this.vector_weight = opts.vector_weight === undefined ? CFG.VECTOR_WEIGHT : opts.vector_weight;
    this.keyword_weight = opts.keyword_weight === undefined ? CFG.KEYWORD_WEIGHT : opts.keyword_weight;
    this.embedder = this.vector_enabled ? new AP.Embedder(opts.vector_dim || CFG.VECTOR_DIM) : null;
    this._vec_cache = {};
  }
  LongTermMemory.prototype._key = function (type) {
    return PREFIX + (type === 'semantic' ? 'semantic' : (type === 'procedural' ? 'procedural' : 'episodic'));
  };
  LongTermMemory.prototype._readList = function (key) {
    var raw = Store.get(key);
    if (!raw) return [];
    try { var v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  };
  LongTermMemory.prototype._writeList = function (key, data) {
    try { Store.set(key, JSON.stringify(data)); } catch (e) { /* 配额满则忽略 */ }
  };
  LongTermMemory.prototype._embedding_of = function (item) {
    if (!this.vector_enabled || !this.embedder) return null;
    if (!this._vec_cache[item.id]) {
      this._vec_cache[item.id] = this.embedder.embed(item.content + ' ' + item.summary + ' ' + (item.tags || []).join(' '));
    }
    return this._vec_cache[item.id];
  };
  LongTermMemory.prototype._similarity = function (a, b) {
    if (this.vector_enabled && this.embedder) {
      return AP.Embedder.cosine(this._embedding_of(a), this._embedding_of(b));
    }
    var ta = {}, tb = {};
    tokenize(a.content).forEach(function (x) { ta[x] = 1; });
    tokenize(b.content).forEach(function (x) { tb[x] = 1; });
    var ka = Object.keys(ta), kb = Object.keys(tb);
    if (!ka.length || !kb.length) return 0;
    var inter = ka.filter(function (x) { return tb[x]; }).length;
    var union = {};
    ka.forEach(function (x) { union[x] = 1; });
    kb.forEach(function (x) { union[x] = 1; });
    return inter / Object.keys(union).length;
  };
  LongTermMemory.prototype._persist = function (item) {
    var key = this._key(item.type);
    var data = this._readList(key);
    data.push(item.to_dict());
    if (data.length > this.capacity) {
      data.sort(function (a, b) { return (b.importance || 0) - (a.importance || 0); });
      data = data.slice(0, this.capacity);
    }
    this._writeList(key, data);
  };
  LongTermMemory.prototype._update_persisted = function (item) {
    var key = this._key(item.type);
    var data = this._readList(key);
    var found = false;
    for (var i = 0; i < data.length; i++) {
      if (data[i].id === item.id) { data[i] = item.to_dict(); found = true; break; }
    }
    if (!found) data.push(item.to_dict());
    this._writeList(key, data);
  };
  /* 归档：把某条记忆标记为 superseded（用户改口后旧身份不再生效），不删除证据 */
  LongTermMemory.prototype.archive = function (id, reason) {
    var hit = null;
    this.all_items().forEach(function (item) {
      if (item.id === id && item.status === 'active') {
        item.status = 'superseded';
        item.updated_at = nowISO();
        if (reason) item.tags = (item.tags || []).concat(['superseded:' + reason]);
        this._update_persisted(item);
        delete this._vec_cache[item.id];
        hit = item;
      }
    }, this);
    return hit;
  };

  LongTermMemory.prototype.all_items = function () {
    var out = [];
    ['episodic', 'semantic', 'procedural'].forEach(function (t) {
      this._readList(this._key(t)).forEach(function (d) { out.push(MemoryItem.from_dict(d)); });
    }, this);
    return out;
  };
  LongTermMemory.prototype._find_duplicate = function (new_item) {
    if (!this.dedup_enabled) return null;
    var best = null, best_sim = 0;
    this.all_items().forEach(function (item) {
      if (item.status !== 'active' || item.type !== new_item.type) return;
      var sim = this._similarity(new_item, item);
      if (sim > best_sim) { best = item; best_sim = sim; }
    }, this);
    return (best && best_sim >= this.dedup_threshold) ? best : null;
  };
  LongTermMemory.prototype._merge_into = function (existing, new_item) {
    existing.importance = Math.min(1, existing.importance + 0.1);
    existing.confidence = Math.min(1, existing.confidence + 0.05);
    existing.access_count += 1;
    existing.updated_at = nowISO();
    var seen = {};
    existing.tags = (existing.tags || []).concat(new_item.tags || []).filter(function (t) {
      if (seen[t]) return false; seen[t] = 1; return true;
    });
    if (new_item.content.length > existing.content.length) existing.content = new_item.content;
    this._update_persisted(existing);
    delete this._vec_cache[existing.id];
    return existing;
  };
  LongTermMemory.prototype.add = function (content, mem_type, summary, tags, importance, source) {
    var item = new MemoryItem({
      type: mem_type || 'episodic', content: content,
      summary: summary || String(content || '').slice(0, 50),
      tags: tags || [], importance: importance === undefined ? 0.5 : importance, source: source || ''
    });
    var dup = this._find_duplicate(item);
    if (dup) return this.dedup_strategy === 'merge' ? this._merge_into(dup, item) : dup;
    this._persist(item);
    return item;
  };
  LongTermMemory.prototype.search = function (query, top_k, mem_type) {
    var qset = {};
    tokenize(query).forEach(function (x) { qset[x] = 1; });
    var qn = Object.keys(qset).length;
    var q_vec = (this.vector_enabled && this.embedder) ? this.embedder.embed(query) : null;
    var now = Date.now() / 1000;
    var scored = [];
    this.all_items().forEach(function (item) {
      if (item.status !== 'active') return;
      if (mem_type && item.type !== mem_type) return;
      var doc = item.content + ' ' + item.summary + ' ' + (item.tags || []).join(' ');
      var dset = {};
      tokenize(doc).forEach(function (x) { dset[x] = 1; });
      var dn = Object.keys(dset).length;
      var kw = 0;
      if (qn && dn) {
        var overlap = Object.keys(qset).filter(function (x) { return dset[x]; }).length;
        if (overlap) kw = overlap / Math.sqrt(qn * dn);
      }
      var vec = 0;
      if (q_vec) vec = Math.max(0, AP.Embedder.cosine(q_vec, this._embedding_of(item)));
      if (kw === 0 && vec < 0.1) return;
      var age_days = 0;
      var t = Date.parse(item.created_at);
      if (!isNaN(t)) age_days = now - t / 1000;
      var recency = Math.exp(-0.02 * Math.max(0, age_days / 86400));
      var base = this.vector_enabled ? (this.vector_weight * vec + this.keyword_weight * kw) : kw;
      scored.push([0.7 * base + 0.2 * item.importance + 0.1 * recency, item]);
    }, this);
    scored.sort(function (a, b) { return b[0] - a[0]; });
    var results = scored.slice(0, top_k || CFG.RETRIEVE_TOP_K).map(function (x) { return x[1]; });
    this.touch(results.map(function (it) { return it.id; }));
    return results;
  };
  LongTermMemory.prototype.touch = function (ids) {
    if (!ids || !ids.length) return;
    var idset = {};
    ids.forEach(function (x) { idset[x] = 1; });
    var self = this;
    ['semantic', 'procedural'].forEach(function (t) {
      var key = self._key(t);
      var data = self._readList(key);
      var changed = false;
      data.forEach(function (d) {
        if (idset[d.id]) {
          d.access_count = (d.access_count || 0) + 1;
          d.last_accessed_at = nowISO();
          changed = true;
        }
      });
      if (changed) self._writeList(key, data);
    });
  };
  LongTermMemory.prototype.stats = function () {
    var items = this.all_items();
    return {
      total: items.length,
      episodic: items.filter(function (i) { return i.type === 'episodic'; }).length,
      semantic: items.filter(function (i) { return i.type === 'semantic'; }).length,
      procedural: items.filter(function (i) { return i.type === 'procedural'; }).length
    };
  };

  /* ---------------- 记忆管理器 ---------------- */
  function MemoryManager(opts) {
    opts = opts || {};
    this.auto_save = opts.auto_save === undefined ? CFG.AUTO_SAVE : opts.auto_save;
    this.auto_save_every_n_turns = Math.max(1, opts.auto_save_every_n_turns || CFG.AUTO_SAVE_EVERY_N_TURNS);
    this.auto_save_on_overflow = opts.auto_save_on_overflow === undefined ? CFG.AUTO_SAVE_ON_OVERFLOW : opts.auto_save_on_overflow;
    this._turns_since_save = 0;
    this.long_term = new LongTermMemory(opts);
    var self = this;
    this.short_term = new ShortTermMemory(
      opts.short_term_max_turns || CFG.SHORT_TERM_MAX_TURNS,
      this.auto_save_on_overflow ? function (ov) { self._on_overflow(ov); } : null
    );
    this.working = new WorkingMemory();
  }
  MemoryManager.prototype._summarize_messages = function (messages) {
    var users = messages.filter(function (m) { return m.role === 'user' && m.content; })
      .map(function (m) { return m.content; });
    return users.length ? users.slice(-3).join('；') : '';
  };
  MemoryManager.prototype._on_overflow = function (overflow) {
    var summary = this._summarize_messages(overflow);
    if (summary) {
      this.long_term.add('（自动）对话片段：' + summary, 'episodic', summary.slice(0, 50),
        ['自动沉淀', '溢出'], 0.35, 'auto-overflow');
    }
  };
  MemoryManager.prototype.maybe_auto_save = function () {
    if (!this.auto_save) return null;
    this._turns_since_save += 1;
    if (this._turns_since_save < this.auto_save_every_n_turns) return null;
    var summary = this._summarize_messages(this.short_term.get());
    this._turns_since_save = 0;
    if (!summary) return null;
    return this.long_term.add('（自动）对话摘要：' + summary, 'episodic', summary.slice(0, 50),
      ['自动沉淀', '周期'], 0.45, 'auto-periodic');
  };
  MemoryManager.prototype.remember = function (content, mem_type, tags, importance) {
    return this.long_term.add(content, mem_type || 'semantic', null, tags || [], importance === undefined ? 0.6 : importance, 'user');
  };
  MemoryManager.prototype.recall = function (query, top_k) {
    return this.long_term.search(query, top_k || CFG.RETRIEVE_TOP_K);
  };
  MemoryManager.prototype.build_context = function (query, top_k) {
    var memories = this.recall(query, top_k);
    if (!memories.length) return '';
    var label = { episodic: '经历', semantic: '事实', procedural: '经验' };
    var lines = ['【相关长期记忆】'];
    memories.forEach(function (m) { lines.push('- (' + (label[m.type] || m.type) + ') ' + m.content); });
    return lines.join('\n');
  };
  MemoryManager.prototype.stats = function () { return this.long_term.stats(); };

  AP.CFG = CFG;
  AP.Store = Store;
  AP.MemoryItem = MemoryItem;
  AP.ShortTermMemory = ShortTermMemory;
  AP.WorkingMemory = WorkingMemory;
  AP.LongTermMemory = LongTermMemory;
  AP.MemoryManager = MemoryManager;
})(typeof window !== 'undefined' ? window : globalThis);

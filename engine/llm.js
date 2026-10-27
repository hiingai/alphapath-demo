/* AlphaPath · LLM 适配层（移植自 v1.4 agent/llm.py，改为浏览器 fetch + BYOK）
 * - 无 Key：MockLLM（确定性离线引擎，内部走规则路由）
 * - 有 Key：OpenAI/DeepSeek 兼容 /chat/completions，支持 tools 与 SSE 流式
 * Key 只存本机 localStorage（键 ap:llm:key），不上传任何服务器。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = (global.AP || {}));

  var KEY_K = 'ap:llm:key', BASE_K = 'ap:llm:base', MODEL_K = 'ap:llm:model';
  var DEFAULT_BASE = 'https://api.deepseek.com/v1';
  var DEFAULT_MODEL = 'deepseek-chat';
  var DEFAULT_TEMP = 0.3;

  AP.LLM_DEFAULTS = { base: DEFAULT_BASE, model: DEFAULT_MODEL, timeout: 60000, temperature: DEFAULT_TEMP };

  AP.LLMSettings = {
    getKey: function () { return (AP.Store.get(KEY_K) || '').trim(); },
    setKey: function (v) { if (v) AP.Store.set(KEY_K, v); else AP.Store.del(KEY_K); },
    getBase: function () { return (AP.Store.get(BASE_K) || DEFAULT_BASE).trim(); },
    setBase: function (v) { if (v) AP.Store.set(BASE_K, v); else AP.Store.del(BASE_K); },
    getModel: function () { return (AP.Store.get(MODEL_K) || DEFAULT_MODEL).trim(); },
    setModel: function (v) { if (v) AP.Store.set(MODEL_K, v); else AP.Store.del(MODEL_K); },
    clear: function () { AP.Store.del(KEY_K); AP.Store.del(BASE_K); AP.Store.del(MODEL_K); }
  };

  var S = AP.LLMSettings;

  /* ---------------- MockLLM（离线确定性引擎） ---------------- */
  AP.MockLLM = function MockLLM() {
    this.router = null;
    this.tool_caller = null;
    this.GREETINGS = ['你好', '您好', 'hi', 'hello', '嗨', '在吗'];
    this.fallback = '我可以帮你：① 算清续签窗口与到期日；② 判断你适合哪种身份路径；'
      + '③ 明确某类身份能否永居；④ 7 年永居进度诊断；⑤ 择校与升学路径推演；'
      + '⑥ 政策更新解读。涉及永居的问题，我会先确认你的身份类型。';
  };
  AP.MockLLM.prototype.bind = function (router, tool_caller) {
    if (router) this.router = router;
    if (tool_caller) this.tool_caller = tool_caller;
    return this;
  };
  AP.MockLLM.prototype.reply = function (user_input, memory_context) {
    var text = String(user_input == null ? '' : user_input).trim();
    var low = text.toLowerCase();
    var self = this;
    if (this.GREETINGS.some(function (g) { return low.indexOf(g) >= 0; }) && text.length <= 6) {
      return '你好！我是 AlphaPath 智能体，专注香港身份续签与教育择校。\n'
        + '- 生成时间线：我的高才通A类 2023-09-01 激活，帮我生成 7 年主航道\n'
        + '- 择校匹配：孩子读中一，想找 DSE 课程、学费低的学校\n'
        + '- 合规自检：受雇续签，雇主刚成立 3 个月且无租约，有风险吗';
    }
    if (this.router && this.tool_caller) {
      var route = this.router(text);
      if (route) return '（离线规则路由：' + route.tool + '）\n' + this.tool_caller(route.tool, route.arg);
    }
    if (memory_context) return '（离线模式，已参考历史记忆）\n关于「' + text + '」：' + self.fallback;
    return '我收到了：「' + text + '」。\n' + self.fallback;
  };

  function normalizeMessages(messages) {
    return (messages || []).map(function (m) {
      var item = { role: m.role || 'user' };
      item.content = (m.content === undefined || m.content === null) ? '' : m.content;
      if (m.tool_calls) item.tool_calls = m.tool_calls;
      if (m.tool_call_id !== undefined && m.tool_call_id !== null) item.tool_call_id = m.tool_call_id;
      if (m.name) item.name = m.name;
      return item;
    });
  }

  function LLMClient() { this.mock = new AP.MockLLM(); }
  LLMClient.prototype.hasApi = function () { return !!S.getKey(); };
  LLMClient.prototype._url = function () {
    return S.getBase().replace(/\/+$/, '') + '/chat/completions';
  };
  LLMClient.prototype._payload = function (messages, system, stream, tools, temperature) {
    var full = (system ? [{ role: 'system', content: system }] : []).concat(normalizeMessages(messages));
    var body = {
      model: S.getModel(), messages: full,
      temperature: temperature === undefined ? DEFAULT_TEMP : temperature
    };
    if (stream) body.stream = true;
    if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    return body;
  };
  LLMClient.prototype._post = function (payload) {
    var key = S.getKey();
    if (!key) return Promise.reject(new Error('NO_API_KEY'));
    return fetch(this._url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(payload)
    });
  };
  LLMClient.prototype._mockText = function (messages, system) {
    var user_msg = '';
    for (var i = messages.length - 1; i >= 0; i--) {
      if ((messages[i].role || '') === 'user') { user_msg = messages[i].content || ''; break; }
    }
    var has_mem = !!(system && system.indexOf('相关长期记忆') >= 0);
    return this.mock.reply(user_msg, has_mem ? 'mem' : '');
  };

  LLMClient.prototype.chat = async function (messages, system) {
    if (!this.hasApi()) return this._mockText(messages, system);
    try {
      var resp = await this._post(this._payload(messages, system, false));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      var msg = data.choices && data.choices[0] && data.choices[0].message;
      return (msg && msg.content) || '';
    } catch (e) {
      return '[LLM 调用失败，已降级] ' + (e && e.message ? e.message : e) + '\n\n' + this._mockText(messages, '');
    }
  };

  LLMClient.prototype.chatStream = async function (messages, system, onDelta) {
    if (!this.hasApi()) {
      var text = this._mockText(messages, system);
      for (var i = 0; i < text.length; i += 14) if (onDelta) onDelta(text.slice(i, i + 14));
      return;
    }
    var got = false;
    try {
      var resp = await this._post(this._payload(messages, system, true));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var reader = resp.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '', done = false;
      while (!done) {
        var r = await reader.read();
        if (r.done) { done = true; break; }
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var k = 0; k < lines.length; k++) {
          var line = lines[k].trim();
          if (!line || line.indexOf('data:') !== 0) continue;
          var raw = line.slice(5).trim();
          if (raw === '[DONE]') { done = true; break; }
          var chunk = null;
          try { chunk = JSON.parse(raw); } catch (e) { continue; }
          var delta = null;
          try { delta = chunk.choices[0].delta && chunk.choices[0].delta.content; } catch (e2) { delta = null; }
          if (delta) { got = true; if (onDelta) onDelta(delta); }
        }
      }
      if (!got) { var fb = await this.chat(messages, system); if (onDelta) onDelta(fb); }
    } catch (e) {
      if (!got && onDelta) onDelta('[LLM 流式失败，已降级] ' + (e && e.message ? e.message : e) + '\n\n' + this._mockText(messages, ''));
    }
  };

  LLMClient.prototype.chatWithTools = async function (messages, system, tools) {
    if (!this.hasApi()) return null;
    try {
      var resp = await this._post(this._payload(messages, system, false, tools));
      if (!resp.ok) {
        if (resp.status === 400) throw new Error('NOT_IMPLEMENTED');
        return null;
      }
      var data = await resp.json();
      var msg = data.choices[0].message;
      return { content: msg.content === undefined ? null : msg.content, tool_calls: msg.tool_calls || [] };
    } catch (e) {
      if (e && e.message === 'NOT_IMPLEMENTED') throw e;
      return null;
    }
  };

  LLMClient.prototype.chatStreamWithTools = async function (messages, system, tools, onDelta) {
    if (!this.hasApi()) return null;
    try {
      var resp = await this._post(this._payload(messages, system, true, tools));
      if (!resp.ok) {
        if (resp.status === 400) throw new Error('NOT_IMPLEMENTED');
        return await this.chatWithTools(messages, system, tools);
      }
      var reader = resp.body.getReader();
      var dec = new TextDecoder('utf-8');
      var buf = '', done = false, got = false;
      var content_parts = [], tool_acc = {};
      while (!done) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line || line.indexOf('data:') !== 0) continue;
          var raw = line.slice(5).trim();
          if (raw === '[DONE]') { done = true; break; }
          var chunk = null;
          try { chunk = JSON.parse(raw); } catch (e) { continue; }
          got = true;
          var delta = {};
          try { delta = chunk.choices[0].delta || {}; } catch (e2) { delta = {}; }
          if (delta.content) {
            content_parts.push(delta.content);
            if (onDelta) { try { onDelta(delta.content); } catch (e3) { /* ignore */ } }
          }
          var tcs = delta.tool_calls || [];
          for (var j = 0; j < tcs.length; j++) {
            var tc = tcs[j];
            var idx = tc.index === undefined ? 0 : tc.index;
            if (!tool_acc[idx]) tool_acc[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
            var slot = tool_acc[idx];
            if (tc.id) slot.id = tc.id;
            var fn = tc.function || {};
            if (fn.name) slot.function.name = fn.name;
            if (fn.arguments) slot.function.arguments += fn.arguments;
          }
        }
      }
      if (!got) return await this.chatWithTools(messages, system, tools);
      var calls = Object.keys(tool_acc).map(Number).sort(function (a, b) { return a - b; })
        .map(function (k) { return tool_acc[k]; });
      return { content: content_parts.join('') || null, tool_calls: calls };
    } catch (e) {
      if (e && e.message === 'NOT_IMPLEMENTED') throw e;
      return await this.chatWithTools(messages, system, tools);
    }
  };

  AP.LLMClient = LLMClient;
})(typeof window !== 'undefined' ? window : globalThis);

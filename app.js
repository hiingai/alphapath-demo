/* AlphaPath v1.4 在线体验 · 前端逻辑
 * 全部数据来自本地引擎（engine/*.js），不发任何业务请求；
 * 只有在你填了自己的 Key 后，才由浏览器直连 api.deepseek.com。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var agent = null;
  var sending = false;
  var turnToolMs = 0;

  var EXAMPLES = [
    '我是高才B类，2025.2.1激活签证，什么时候能拿永居？',
    '我的高才通A类 2023-09-01 激活，帮我生成 7 年主航道',
    '外佣能不能拿永居？',
    '受养人签证怎么办？保证人到期了会怎样',
    '高才通有签证空档，算不算永居年限',
    '孩子读中一，想找 DSE 课程、学费低的学校',
    '受雇续签，雇主刚成立 3 个月且无租约，有风险吗',
    '学生签证期间算不算 7 年',
    '耦合 C4 是什么意思',
    '怎么把逾期记录处理掉？',
    '计算 12*(3+4)'
  ];

  /* ---------------- 基础工具 ---------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function scrollBottom() {
    var c = $('chat');
    c.scrollTop = c.scrollHeight;
  }
  function fmtTime() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* ---------------- 侧栏渲染 ---------------- */
  function renderChips() {
    var box = $('chips');
    box.textContent = '';
    EXAMPLES.forEach(function (q) {
      var b = el('button', 'chip', q);
      b.addEventListener('click', function () {
        if (sending) return;
        $('input').value = q;
        send();
      });
      box.appendChild(b);
    });
  }

  function renderTools() {
    var list = agent.list_tools();
    var box = $('toolList');
    box.textContent = '';
    list.forEach(function (t) {
      var tag = el('span', 'tool-tag', t.name);
      tag.title = t.description;
      box.appendChild(tag);
    });
    $('toolCount').textContent = '（' + list.length + ' 个）';
  }

  function renderMem() {
    var box = $('memList');
    var items = agent.list_memories(30);
    var st = agent.stats();
    $('memStat').textContent = '（' + st.memory.total + ' 条）';
    box.textContent = '';
    if (!items.length) {
      box.appendChild(el('p', 'hint', '暂无记忆。对话满 3 轮会自动沉淀，也可以说「记住：…」。'));
      return;
    }
    items.forEach(function (m) {
      var d = el('div', 'mem-item');
      d.appendChild(el('div', 't', ({ episodic: '经历', semantic: '事实', procedural: '经验' }[m.type] || m.type)
        + ' · ' + (m.created_at || '').slice(0, 19).replace('T', ' ')));
      d.appendChild(el('div', null, m.content));
      box.appendChild(d);
    });
  }

  function renderStats() {
    var st = agent.stats();
    $('ruleVersion').textContent = '规则版本 ' + (st.rag_coverage.version || '');
    $('corpusStat').textContent = '语料 ' + (st.rag_coverage.total || 0) + ' 条 / 规则 ' + (st.rag_coverage.rules || 0);
    var live = AP.settings.get().hasKey;
    $('modeDot').className = 'dot' + (live ? ' live' : '');
    $('modeText').textContent = live ? '已接入大模型（BYOK）' : '离线规则引擎';
    $('modeHint').textContent = live
      ? '已检测到你的 Key：会追加自然语言组织与多轮工具编排；Key 只存在本机浏览器。'
      : '未接入大模型：日期/资格/合规结论全部由本地确定性引擎计算，可直接体验。';
    $('llmBadge').textContent = live ? 'API 模式' : '离线';
    $('llmBadge').className = 'badge' + (live ? ' live' : '');
  }

  /* ---------------- 消息渲染 ---------------- */
  function addUser(text) {
    var wrap = el('div', 'msg user');
    wrap.appendChild(el('div', 'avatar', '🙋'));
    var b = el('div', 'bubble');
    b.appendChild(el('p', null, text));
    wrap.appendChild(b);
    $('chat').appendChild(wrap);
    scrollBottom();
  }

  function addAssistantShell() {
    var wrap = el('div', 'msg assistant');
    wrap.appendChild(el('div', 'avatar', '🧭'));
    var bubble = el('div', 'bubble');
    wrap.appendChild(bubble);
    $('chat').appendChild(wrap);
    scrollBottom();
    return { wrap: wrap, bubble: bubble, answer: null, article: null };
  }

  function setAnswer(shell, text) {
    if (!shell.article) {
      shell.article = el('p');
      shell.bubble.appendChild(shell.article);
    }
    shell.article.textContent = text;
    shell.answer = text;
    scrollBottom();
  }

  function appendStep(shell, text) {
    var s = el('div', 'step', '· ' + text);
    shell.bubble.appendChild(s);
    scrollBottom();
  }

  function appendToolCard(shell, ev) {
    var card = el('div', 'toolcard' + (ev.ok === false ? ' fail' : ''));
    var head = el('div', 'th');
    head.appendChild(el('span', null, ev.ok === false ? '⚠️' : '🔧'));
    head.appendChild(el('span', 'nm', ev.name));
    if (ev.arg) head.appendChild(el('span', null, String(ev.arg).slice(0, 60)));
    var ms = el('span', 'ms', '调用中…');
    head.appendChild(ms);
    card.appendChild(head);
    var body = el('div', 'tbody');
    card.appendChild(body);
    head.addEventListener('click', function () { card.classList.toggle('open'); });
    card._ms = ms;
    card._body = body;
    card._t0 = performance.now();
    card._name = ev.name;
    shell.bubble.appendChild(card);
    shell.lastCard = card;
    scrollBottom();
    return card;
  }

  function fillToolCard(card, ev) {
    if (!card) return;
    var ms = Math.round(performance.now() - card._t0);
    card._ms.textContent = ms + ' ms';
    var body = card._body;
    body.textContent = '';
    if (ev.arg) {
      var kv = el('div', 'kv', '参数：' + ev.arg);
      body.appendChild(kv);
    }
    var pre = el('pre', null, ev.result || '');
    body.appendChild(pre);
    if (ev.ok === false) card.classList.add('fail');
    if (ms > 220) card.classList.add('open');
    scrollBottom();
  }

  /* ---------------- 发送 ---------------- */
  async function send() {
    var input = $('input');
    var text = input.value.trim();
    if (!text || sending) return;
    sending = true;
    input.value = '';
    input.style.height = 'auto';
    $('send').disabled = true;

    addUser(text);
    var shell = addAssistantShell();
    turnToolMs = 0;

    var onEvent = function (ev) {
      if (!ev || !ev.type) return;
      if (ev.type === 'think') {
        appendStep(shell, ev.text || ('第 ' + ev.round + ' 轮推理'));
      } else if (ev.type === 'tool_call') {
        appendToolCard(shell, { name: ev.name, arg: ev.arg, ok: true });
      } else if (ev.type === 'tool_result') {
        fillToolCard(shell.lastCard, ev);
      } else if (ev.type === 'answer_delta') {
        setAnswer(shell, (shell.answer || '') + (ev.text || ''));
      } else if (ev.type === 'answer') {
        setAnswer(shell, ev.text || '');
      } else if (ev.type === 'auto_saved') {
        appendStep(shell, '已自动沉淀长期记忆：' + ((ev.item && ev.item.summary) || ''));
        renderMem();
      } else if (ev.type === 'error') {
        appendStep(shell, '错误：' + ev.message);
      }
    };

    try {
      var res = await agent.chat(text, onEvent, null);
      if (res && res.escalation && res.escalation.required) {
        appendStep(shell, '⚠️ ' + res.escalation.reason + '（已在页面标注，不替代人工复核）');
      }
      if (res && res.blocked) appendStep(shell, '已按 ' + res.blocked + ' 拦截并仅陈述法律事实。');
    } catch (e) {
      if (e && e.message === 'BUSY') {
        appendStep(shell, '上一条还在处理中，请稍候。');
      } else {
        appendStep(shell, '处理失败：' + (e && e.message ? e.message : e));
      }
    } finally {
      if (!shell.answer) setAnswer(shell, '（没有生成内容）');
      renderMem();
      renderStats();
      sending = false;
      $('send').disabled = false;
      input.focus();
    }
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    var s = AP.settings.get();
    $('keyInput').value = AP.LLMSettings.getKey() || '';
    $('baseInput').value = s.base;
    $('modelInput').value = s.model;
    $('modal').hidden = false;
    $('keyInput').focus();
  }
  function closeSettings() { $('modal').hidden = true; }

  /* ---------------- 启动 ---------------- */
  function boot() {
    agent = AP.Engine.createAgent();
    renderChips();
    renderTools();
    renderMem();
    renderStats();

    $('send').addEventListener('click', send);
    $('input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('input').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 140) + 'px';
    });
    $('refreshMem').addEventListener('click', renderMem);
    $('clearAll').addEventListener('click', function () {
      if (!confirm('清空本机的长期记忆、会话与虚拟文件？此操作不可撤销。')) return;
      ['ap:mem:episodic', 'ap:mem:semantic', 'ap:mem:procedural', 'ap:vfs'].forEach(function (k) { AP.Store.del(k); });
      agent.clear_short_term();
      renderMem();
      appendNotice('已清空本机记忆数据。');
    });
    $('openSettings').addEventListener('click', openSettings);
    $('openSettings2').addEventListener('click', openSettings);
    $('cancelSettings').addEventListener('click', closeSettings);
    $('saveSettings').addEventListener('click', function () {
      AP.settings.setKey($('keyInput').value.trim());
      AP.settings.setBase($('baseInput').value.trim());
      AP.settings.setModel($('modelInput').value.trim());
      closeSettings();
      renderStats();
      appendNotice('设置已保存。' + (AP.settings.get().hasKey ? '已切换到 API 模式。' : '当前为离线引擎模式。'));
    });
    $('clearKey').addEventListener('click', function () {
      AP.settings.clear();
      $('keyInput').value = '';
      closeSettings();
      renderStats();
      appendNotice('已清除本机 Key，回到离线引擎模式。');
    });
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeSettings(); });

    $('openSide').addEventListener('click', function () { $('sidebar').classList.add('open'); });
    $('closeSide').addEventListener('click', function () { $('sidebar').classList.remove('open'); });

    var params = new URLSearchParams(location.search);
    if (params.get('q')) {
      $('input').value = params.get('q');
      setTimeout(send, 120);
    }
  }

  function appendNotice(text) {
    var wrap = el('div', 'msg assistant');
    wrap.appendChild(el('div', 'avatar', 'ℹ️'));
    var b = el('div', 'bubble');
    b.appendChild(el('p', 'muted small', text));
    wrap.appendChild(b);
    $('chat').appendChild(wrap);
    scrollBottom();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* AlphaPath v1.4 在线体验 · 前端逻辑
 * 全部数据来自本地引擎（engine/*.js），不发任何业务请求；
 * 只有在你填了自己的 Key 后，才由浏览器直连 api.deepseek.com。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var agent = null;
  var sending = false;
  var sessionStarted = false;

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
    '把续签材料清单做成带勾选的 HTML',
    '怎么把逾期记录处理掉？',
    '计算 12*(3+4)'
  ];

  /* ---------------- 会话（左栏历史） ---------------- */
  var SES_KEY = 'ap:sessions';
  var SES_MAX = 30;
  var sessions = [];
  var curId = null;

  function loadSessions() {
    var a = [];
    try { a = JSON.parse(localStorage.getItem(SES_KEY) || '[]'); } catch (e) { a = []; }
    if (!Array.isArray(a)) a = [];
    return a.filter(function (s) { return s && s.id && Array.isArray(s.msgs); });
  }
  function saveSessions() {
    try { localStorage.setItem(SES_KEY, JSON.stringify(sessions.slice(0, SES_MAX))); } catch (e) { /* 配额满就放弃 */ }
  }
  function curSession() {
    for (var i = 0; i < sessions.length; i++) if (sessions[i].id === curId) return sessions[i];
    return null;
  }
  function newSession() {
    /* 顺手清掉之前的空会话，避免点几次「新对话」堆一堆 */
    sessions = sessions.filter(function (s) { return s.msgs && s.msgs.length; });
    var s = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: '新对话', at: Date.now(), msgs: [] };
    sessions.unshift(s);
    curId = s.id;
    saveSessions();
    renderSessions();
    return s;
  }
  function pushMsg(m) {
    var s = curSession();
    if (!s) s = newSession();
    m.at = Date.now();
    s.msgs.push(m);
    s.at = m.at;
    if (m.role === 'user' && (s.title === '新对话' || !s.title)) {
      s.title = String(m.text || '').replace(/\s+/g, ' ').slice(0, 22) || '新对话';
    }
    /* 最近活跃的排最前 */
    sessions.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    saveSessions();
    renderSessions();
  }
  function fmtDay(ts) {
    var d = new Date(ts || Date.now());
    var now = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    if (d.toDateString() === now.toDateString()) return p(d.getHours()) + ':' + p(d.getMinutes());
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function renderSessions() {
    var box = $('sesList');
    if (!box) return;
    box.textContent = '';
    $('sesStat').textContent = sessions.length ? '（' + sessions.length + '）' : '';
    if (!sessions.length) {
      box.appendChild(el('p', 'hint', '还没有对话记录。发第一句就会存到这里，刷新也不丢。'));
      return;
    }
    sessions.forEach(function (s) {
      var row = el('div', 'ses-item' + (s.id === curId ? ' active' : ''));
      var main = el('div', 'ses-main');
      main.appendChild(el('div', 'ses-t', s.title || '新对话'));
      main.appendChild(el('div', 'ses-d', fmtDay(s.at) + ' · ' + (s.msgs.length ? Math.ceil(s.msgs.filter(function (m) { return m.role === 'user'; }).length) + ' 问' : '空')));
      row.appendChild(main);
      var del = el('button', 'ses-del', '✕');
      del.title = '删除这条对话';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('删除这条对话？（不影响长期记忆）')) return;
        sessions = sessions.filter(function (x) { return x.id !== s.id; });
        if (curId === s.id) { curId = null; startBlank(); }
        saveSessions();
        renderSessions();
      });
      row.appendChild(del);
      row.addEventListener('click', function () { openSession(s.id); });
      box.appendChild(row);
    });
  }
  function startBlank() {
    agent.clear_short_term();
    $('chat').innerHTML = homeHTML;
    if (!curSession()) newSession();
  }
  function openSession(id) {
    if (id === curId && curSession()) { $('sidebar').classList.remove('open'); return; }
    curId = id;
    var s = curSession();
    if (!s) return;
    agent.clear_short_term();
    $('chat').innerHTML = '';
    s.msgs.forEach(function (m) {
      if (m.role === 'user') {
        addUser(m.text);
        agent.memory.short_term.add('user', m.text);
      } else if (m.role === 'assistant') {
        renderSavedAnswer(m);
        agent.memory.short_term.add('assistant', m.text || '');
      } else if (m.role === 'notice') {
        appendNotice(m.text);
      }
    });
    if (!s.msgs.length) $('chat').innerHTML = homeHTML;
    renderSessions();
    scrollBottom();
    $('sidebar').classList.remove('open');
  }
  function renderSavedAnswer(m) {
    var shell = addAssistantShell();
    (m.steps || []).forEach(function (t) { appendStep(shell, t); });
    if (m.artifact) {
      var card = el('div', 'toolcard open');
      var head = el('div', 'th');
      head.appendChild(el('span', null, '📄'));
      head.appendChild(el('span', 'nm', 'make_file'));
      card.appendChild(head);
      var body = el('div', 'tbody');
      card.appendChild(body);
      body.appendChild(renderArtifact(m.artifact));
      shell.proc.appendChild(card);
    }
    setAnswer(shell, m.text || '');
    if (shell.sealed && shell.proc.children.length - 1 >= 3) { shell.proc.classList.add('fold'); shell.sync(); }
    return shell;
  }

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
      b.title = '点一下填进输入框，改成你自己的情况再发送';
      b.addEventListener('click', function () {
        if (sending) return;
        var inp = $('input');
        inp.value = q;
        inp.focus();
        try { inp.setSelectionRange(q.length, q.length); } catch (e) { /* ignore */ }
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 140) + 'px';
        inp.classList.add('flash');
        setTimeout(function () { inp.classList.remove('flash'); }, 700);
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
    /* 过程区（步骤 + 工具卡片）固定在回答上方，回答只追加在它下面 */
    var proc = el('div', 'proc');
    bubble.appendChild(proc);
    var article = el('p', 'ans');
    bubble.appendChild(article);
    wrap.appendChild(bubble);
    $('chat').appendChild(wrap);
    scrollBottom();
    return { wrap: wrap, bubble: bubble, proc: proc, answer: null, article: article, steps: 0, sealed: false };
  }

  function sealProc(shell) {
    if (shell.sealed || !shell.proc.children.length) return;
    shell.sealed = true;
    var head = el('div', 'prochead');
    var dot = el('span', 'dot');
    var t = el('span', 'pt');
    head.appendChild(dot);
    head.appendChild(t);
    shell.procHead = head;
    shell.pt = t;
    var sync = function () {
      var n = shell.proc.children.length - 1;
      t.textContent = '推理过程 · ' + n + ' 项 · ' + (shell.proc.classList.contains('fold') ? '点击展开' : '点击收起');
    };
    shell.sync = sync;
    head.addEventListener('click', function () {
      shell.userToggled = true;
      shell.proc.classList.toggle('fold');
      sync();
    });
    shell.proc.insertBefore(head, shell.proc.firstChild);
    shell.proc.classList.add('done');
    /* 过程很短（单次工具调用）就保持展开，留住「真调用」的可信感；长过程默认收起 */
    if (shell.proc.children.length - 1 >= 3) shell.proc.classList.add('fold');
    sync();
  }

  function setAnswer(shell, text) {
    var shown = String(text == null ? '' : text).replace(/\n*ARTIFACT:\{[\s\S]*$/, '').trim();
    shell.article.textContent = shown;
    shell.answer = text;
    if (shown) sealProc(shell);
    scrollBottom();
  }

  function appendStep(shell, text) {
    var s = el('div', 'step', '· ' + text);
    shell.proc.appendChild(s);
    if (shell.sealed && shell.pt) {
      shell.pt.textContent = '推理过程 · ' + (shell.proc.children.length - 1) + ' 项 · '
        + (shell.proc.classList.contains('fold') ? '点击展开' : '点击收起');
    }
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
    shell.proc.appendChild(card);
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
    var art = artifactFrom(ev.result);
    if (art) {
      card.classList.add('open');
      body.appendChild(renderArtifact(art));
    } else {
      body.appendChild(el('pre', null, ev.result || ''));
    }
    if (ev.ok === false) card.classList.add('fail');
    if (ms > 220 || art) card.classList.add('open');
    scrollBottom();
  }

  /* ---------------- 生成的文件（可勾选清单） ---------------- */
  function artifactFrom(result) {
    var s = String(result == null ? '' : result);
    var i = s.indexOf('ARTIFACT:');
    if (i < 0) return null;
    try { return JSON.parse(s.slice(i + 9)); } catch (e) { return null; }
  }

  function renderArtifact(spec) {
    var box = el('div', 'artifact');
    var head = el('div', 'ah');
    head.appendChild(el('span', 'ic', '📄'));
    head.appendChild(el('span', 'tt', spec.title || '清单'));
    head.appendChild(el('span', 'sub', (spec.items || []).length + ' 项 · 勾选存本机'));
    box.appendChild(head);

    var key = 'ap:art:' + (spec.path || spec.title || 'list');
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { saved = {}; }
    var list = el('div', 'alist');
    var boxes = [];
    (spec.items || []).forEach(function (t, i) {
      var row = el('label', 'arow');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!saved[i];
      cb.addEventListener('change', function () {
        row.classList.toggle('done', cb.checked);
        var o = {};
        boxes.forEach(function (b, j) { o[j] = b.checked; });
        try { localStorage.setItem(key, JSON.stringify(o)); } catch (e) { /* 配额满 */ }
        updateCount();
      });
      if (cb.checked) row.classList.add('done');
      boxes.push(cb);
      row.appendChild(cb);
      row.appendChild(el('span', 'at', t));
      list.appendChild(row);
    });
    box.appendChild(list);

    var bar = el('div', 'abar');
    var bAll = el('button', 'abtn', '全选');
    bAll.addEventListener('click', function () {
      boxes.forEach(function (b) { b.checked = true; b.dispatchEvent(new Event('change')); });
      updateCount();
    });
    var bNone = el('button', 'abtn', '清空');
    bNone.addEventListener('click', function () {
      boxes.forEach(function (b) { b.checked = false; b.dispatchEvent(new Event('change')); });
      updateCount();
    });
    var bDl = el('button', 'abtn primary', '下载 HTML');
    bDl.addEventListener('click', function () {
      var html = spec.html || '';
      if (!html) return;
      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (spec.title || 'checklist') + '.html';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
    bar.appendChild(bAll);
    bar.appendChild(bNone);
    bar.appendChild(bDl);
    box.appendChild(bar);

    var foot = el('div', 'afoot');
    box.appendChild(foot);
    function updateCount() {
      var n = boxes.filter(function (b) { return b.checked; }).length;
      foot.textContent = '已勾选 ' + n + ' / ' + boxes.length + ' 项'
        + (spec.path ? ' · 已存到沙箱 ' + spec.path : '');
    }
    updateCount();
    return box;
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
    if (!curSession()) newSession();
    pushMsg({ role: 'user', text: text });
    var shell = addAssistantShell();
    var t0 = Date.now();

    var onEvent = function (ev) {
      if (!ev || !ev.type) return;
      if (ev.type === 'think') {
        appendStep(shell, ev.text || ('第 ' + ev.round + ' 轮推理'));
      } else if (ev.type === 'tool_call') {
        appendToolCard(shell, { name: ev.name, arg: ev.arg, ok: true });
      } else if (ev.type === 'tool_result') {
        fillToolCard(shell.lastCard, ev);
        var a = artifactFrom(ev.result);
        if (a) shell.artifact = {
          kind: a.kind, title: a.title, items: a.items, path: a.path, note: a.note,
          html: (a.html && a.html.length <= 9000) ? a.html : ''
        };
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
      /* 一轮结束后再判断折叠：过程长就收起，只留结论在最后一行 */
      if (shell.sealed && !shell.userToggled && shell.proc.children.length - 1 >= 3) {
        shell.proc.classList.add('fold');
        shell.sync();
      }
      /* 归档到会话历史：只存渲染需要的部分 */
      var steps = [];
      if (shell.proc) {
        [].forEach.call(shell.proc.children, function (c) {
          if (c.className.indexOf('step') === 0) steps.push(c.textContent.replace(/^·\s*/, ''));
        });
      }
      pushMsg({
        role: 'assistant', text: shell.answer || '', steps: steps,
        artifact: shell.artifact || null, ms: Date.now() - t0
      });
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
  var homeHTML = '';

  function boot() {
    agent = AP.Engine.createAgent();
    homeHTML = $('chat').innerHTML;
    sessions = loadSessions();
    renderChips();
    renderTools();
    renderMem();
    renderStats();
    renderSessions();

    $('send').addEventListener('click', send);
    $('input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    $('input').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 140) + 'px';
    });
    $('refreshMem').addEventListener('click', renderMem);
    $('newChat').addEventListener('click', function () {
      curId = null;
      newSession();
      startBlank();
      $('input').focus();
    });
    $('clearAll').addEventListener('click', function () {
      if (!confirm('清空本机的长期记忆、对话记录与虚拟文件？此操作不可撤销。')) return;
      ['ap:mem:episodic', 'ap:mem:semantic', 'ap:mem:procedural', 'ap:vfs', SES_KEY].forEach(function (k) { AP.Store.del(k); });
      agent.clear_short_term();
      sessions = [];
      curId = null;
      $('chat').innerHTML = homeHTML;
      renderSessions();
      renderMem();
      appendNotice('已清空本机记忆与对话数据。');
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
    if (sessions.length && sessions[0].msgs.length) openSession(sessions[0].id);
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

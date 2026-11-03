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

  /* 登录后会话与鱼骨状态按用户隔离存（未登录走访客命名空间） */
  function uidScope() {
    try {
      var db = AP.DB && AP.DB.get ? AP.DB.get() : null;
      var u = db && db.auth ? db.auth.current() : null;
      return u && u.id ? u.id : '';
    } catch (e) { return ''; }
  }
  function scoped(base) { var u = uidScope(); return u ? base + ':u:' + u : base; }

  function loadSessions() {
    var a = [];
    try { a = JSON.parse(localStorage.getItem(scoped(SES_KEY)) || '[]'); } catch (e) { a = []; }
    if (!Array.isArray(a)) a = [];
    return a.filter(function (s) { return s && s.id && Array.isArray(s.msgs); });
  }
  function saveSessions() {
    try { localStorage.setItem(scoped(SES_KEY), JSON.stringify(sessions.slice(0, SES_MAX))); } catch (e) { /* 配额满就放弃 */ }
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
    syncFishFromText(text);
    learnProfile(text);
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

  /* ---------------- 右侧：7 年主航道进度鱼骨图 ---------------- */
  var FISH_KEY = 'ap:fish';
  var FISH_OPEN = 'ap:fish:open2'; /* v2：默认展开网页版（旧键保留但不读，避免老偏好压住新默认） */
  var fishState = { identityType: '', activationDate: '', applyDate: '' };

  function loadFish() {
    try {
      var o = JSON.parse(localStorage.getItem(scoped(FISH_KEY)) || '{}');
      if (o && typeof o === 'object') {
        fishState.identityType = o.identityType || '';
        fishState.activationDate = o.activationDate || '';
        fishState.applyDate = o.applyDate || '';
      }
    } catch (e) { /* 坏数据就当空的 */ }
  }
  function saveFish() {
    try { localStorage.setItem(scoped(FISH_KEY), JSON.stringify(fishState)); } catch (e) { /* 配额满忽略 */ }
  }

  function fillFishIdent() {
    var sel = $('fishIdent');
    if (!sel) return;
    var types = (window.AP_KB && AP_KB.identityTypes) || {};
    sel.textContent = '';
    var blank = document.createElement('option');
    blank.value = ''; blank.textContent = '— 选择身份类型 —';
    sel.appendChild(blank);
    Object.keys(types).forEach(function (code) {
      var o = document.createElement('option');
      o.value = code;
      o.textContent = types[code].name + (types[code].can_pr ? '' : '（不产生永居）');
      sel.appendChild(o);
    });
    sel.value = fishState.identityType || '';
  }

  function renderFish() {
    var wrap = $('fishWrap');
    if (!wrap) return;
    wrap.textContent = '';

    var f = AP.fishbone.build(fishState);
    $('fishIdent').value = fishState.identityType || '';
    $('fishDate').value = fishState.activationDate || '';
    if ($('fishApply')) $('fishApply').value = fishState.applyDate || '';

    if (!f.ok) {
      $('fishFill').style.height = '0%';
      $('fishPct').textContent = '—';
      $('fishSum').textContent = f.message || '还不能画图。';
      $('fishWarn').textContent = '';
      if (f.reason === 'NO_ROUNDS') {
        /* 身份 + 日期都有，只是这类身份不产生永居路径：给结论，不要求再填表 */
        var w = el('div', 'fish-empty');
        w.appendChild(el('div', null, '骨图不需要画——这本身就是结论。'));
        w.appendChild(el('div', null, '换身份类型（高才 / 优才 / 专才 / 受养人）才会出现 7 年主航道。'));
        wrap.appendChild(w);
        return;
      }
      var e = el('div', 'fish-empty');
      e.appendChild(el('div', null, '① 选身份类型（高才 A/B/C、优才、专才…）'));
      e.appendChild(el('div', null, '② 填签证激活日期（入境激活那天，不是获批日）'));
      e.appendChild(el('div', null, '③ 骨图会按引擎口径自动画出首签、各轮续签、7 年届满'));
      wrap.appendChild(e);
      return;
    }

    $('fishFill').style.height = f.progressPct + '%';
    $('fishPct').textContent = f.progressPct + '% · ' + (f.identityName || f.identityType);
    $('fishSum').textContent = AP.fishbone.summary(f);
    $('fishWarn').textContent = (f.warnings || []).join(' ');
    if (f.ruleVersion) $('fishRule').textContent = f.ruleVersion;

    /* 向上的箭头：底部「开始申请」→ 顶部「7 年届满」 */
    wrap.appendChild(el('i', 'arrowhead'));
    var spine = el('div', 'spine');
    var fill = el('i', 'fill');
    fill.style.height = f.progressPct + '%';
    spine.appendChild(fill);
    wrap.appendChild(spine);
    if (f.progressPct > 2 && f.progressPct < 98) {
      var t = el('div', 'today');
      t.style.bottom = f.progressPct + '%';
      t.appendChild(el('span', null, '今天'));
      wrap.appendChild(t);
    }

    var ul = el('ul', 'bones');
    f.nodes.forEach(function (n) {
      var li = el('li', 'bone ' + (n.bone || 'right') + ' ' + n.status + (n.kind === 'finish' ? ' finish' : ''));
      li.appendChild(el('span', 'stem'));
      li.appendChild(el('span', 'fdot'));
      var box = el('div', 'fnode');
      box.appendChild(el('div', 'flabel', n.label + (n.kind === 'finish' ? ' 🏁' : (n.kind === 'start' ? ' 🛫' : (n.kind === 'apply' ? ' 📝' : '')))));
      box.appendChild(el('div', 'fdate', n.date));
      if (n.windowStart) box.appendChild(el('div', 'fwin', '递交窗口 ' + n.windowStart + ' ~ ' + n.windowDeadline));
      if (n.status === 'current') box.appendChild(el('div', 'fwin', '★ 现在该办：建议 ' + n.suggestedSubmitBy + ' 前递交'));
      li.appendChild(box);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
  }

  /* 从一句话里抽身份/激活日，喂给骨图（确定性规则，不问模型） */
  function syncFishFromText(text) {
    if (!text) return false;
    var changed = false;
    var id = AP.Agent && AP.Agent.detect_identity ? AP.Agent.detect_identity(text) : null;
    var d = AP.Agent && AP.Agent._detect_date ? AP.Agent._detect_date(text) : null;
    if (id && id !== fishState.identityType) { fishState.identityType = id; changed = true; }
    if (d && d !== fishState.activationDate) { fishState.activationDate = d; changed = true; }
    if (changed) {
      saveFish();
      renderFish();
      $('fishSrc').textContent = '已从对话自动识别：' + (fishState.identityType || '身份未定') + (fishState.activationDate ? ' · ' + fishState.activationDate + ' 激活' : '');
      flashFish();
    }
    return changed;
  }
  function flashFish() {
    var p = $('fishPanel');
    if (!p) return;
    if (window.innerWidth <= 1180 && !document.body.classList.contains('fish-open')) return;
    p.classList.remove('flash');
    void p.offsetWidth;
    p.classList.add('flash');
  }
  function setFishOpen(open) {
    document.body.classList.toggle('fish-open', !!open);
    try { localStorage.setItem(FISH_OPEN, open ? '1' : '0'); } catch (e) { /* ignore */ }
    if (open) renderFish();
  }

  function initFish() {
    fillFishIdent();
    loadFish();
    renderFish();
    var pref = null;
    try { pref = localStorage.getItem(FISH_OPEN); } catch (e) { pref = null; }
    /* 宽屏（网页版）默认展开；窄屏一律先收起，避免一进来就被抽屉盖住 */
    var open = window.innerWidth > 1180 ? (pref === null ? true : pref === '1') : false;
    setFishOpen(open);

    $('toggleFish').addEventListener('click', function () {
      setFishOpen(!document.body.classList.contains('fish-open'));
    });
    $('closeFish').addEventListener('click', function () { setFishOpen(false); });
    $('fishIdent').addEventListener('change', function () {
      fishState.identityType = this.value;
      saveFish(); renderFish();
      $('fishSrc').textContent = this.value ? '已手动指定身份类型' : '还没选身份类型';
    });
    $('fishDate').addEventListener('change', function () {
      fishState.activationDate = this.value;
      saveFish(); renderFish();
      $('fishSrc').textContent = this.value ? '已手动指定激活日：' + this.value : '还没填激活日期';
    });
    if ($('fishApply')) $('fishApply').addEventListener('change', function () {
      fishState.applyDate = this.value;
      saveFish(); renderFish();
      $('fishSrc').textContent = this.value
        ? '开始申请：' + this.value + '（等待期不计入 7 年，只做展示）'
        : '没填开始申请日，只从激活日开始算。';
    });
    $('fishSync').addEventListener('click', function () {
      var hit = false;
      for (var i = 0; i < sessions.length && !hit; i++) {
        var msgs = sessions[i].msgs || [];
        for (var j = msgs.length - 1; j >= 0; j--) {
          if (msgs[j].role === 'user' && msgs[j].text) {
            var before = fishState.identityType + '|' + fishState.activationDate;
            syncFishFromText(msgs[j].text);
            if (before !== fishState.identityType + '|' + fishState.activationDate) { hit = true; break; }
          }
        }
      }
      if (!hit) $('fishSrc').textContent = '对话里没找到身份/激活日，手动选一下更快。';
      renderFish();
    });
    $('fishReset').addEventListener('click', function () {
      fishState.identityType = '';
      fishState.activationDate = '';
      fishState.applyDate = '';
      saveFish(); renderFish();
      $('fishSrc').textContent = '已重置，重新选身份 + 填激活日。';
    });
  }

  /* ---------------- 主题（浅色默认 / 深色可选） ---------------- */
  var THEME_KEY = 'ap:theme';

  function applyTheme(mode, announce) {
    var t = mode === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
    var b = $('themeBtn');
    if (b) {
      b.innerHTML = t === 'dark' ? '<span class="fico">☀️</span><span class="tlabel">浅色</span>'
        : '<span class="fico">🌙</span><span class="tlabel">深色</span>';
      b.title = t === 'dark' ? '切换到浅色主题' : '切换到深色主题';
    }
    if (announce) appendNotice(t === 'dark' ? '已切换到深色主题。' : '已切换到浅色主题（默认）。');
  }
  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    return t === 'dark' ? 'dark' : 'light';
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { saved = null; }
    applyTheme(saved === 'dark' ? 'dark' : 'light', false); /* 默认浅色 */
    if ($('themeBtn')) $('themeBtn').addEventListener('click', function () {
      applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    });
  }

  /* ---------------- 账号 / 用户档案 ---------------- */
  function db() {
    return AP.DB && AP.DB.get ? AP.DB.get() : null;
  }
  function authApi() { var d = db(); return d ? d.auth : null; }

  function setAuthMsg(text, kind) {
    var m = $('authMsg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'auth-msg' + (kind ? ' ' + kind : '');
  }

  function authView(view) {
    ['login', 'register', 'profile'].forEach(function (v) {
      var box = $('view' + v.charAt(0).toUpperCase() + v.slice(1));
      if (box) box.hidden = v !== view;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.auth-tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    $('authTitle').textContent = view === 'register' ? '创建 AlphaPath 账号'
      : (view === 'profile' ? '我的档案' : '登录 AlphaPath');
    setAuthMsg('');
    if (view === 'profile') refreshProfile();
  }

  function openAuth(view) {
    var u = authApi() && authApi().current();
    $('authTabProfile').hidden = !u;
    authView(view || (u ? 'profile' : 'login'));
    $('authModal').hidden = false;
    setTimeout(function () {
      var first = $('authModal').querySelector('.auth-view:not([hidden]) input');
      if (first) first.focus();
    }, 60);
  }
  function closeAuth() {
    $('authModal').hidden = true;
    setAuthMsg('');
    $('loginPw').value = ''; $('regPw').value = ''; $('regPw2').value = '';
  }

  /* 顶栏账号按钮：未登录=「登录 / 注册」，已登录=昵称 + 小点 */
  function renderAcctBtn() {
    var b = $('acctBtn'), l = $('acctLabel');
    if (!b || !l) return;
    var u = authApi() && authApi().current();
    if (u) {
      l.textContent = u.name || u.email.split('@')[0];
      b.classList.add('signed-in');
      b.title = u.email + ' · 点开「我的档案」';
    } else {
      l.textContent = '登录 / 注册';
      b.classList.remove('signed-in');
      b.title = '账号 / 我的档案';
    }
    $('authTabProfile').hidden = !u;
  }

  /* 登录态变化：会话与鱼骨状态按用户重新载入，需要时把访客会话收编过来 */
  function onAuthChanged(opts) {
    var o = opts || {};
    if (o.adoptGuest && uidScope()) {
      try {
        var gk = SES_KEY, uk = scoped(SES_KEY);
        var guest = JSON.parse(localStorage.getItem(gk) || '[]');
        var mine = JSON.parse(localStorage.getItem(uk) || '[]');
        if (Array.isArray(guest) && guest.length && (!Array.isArray(mine) || !mine.length)) {
          localStorage.setItem(uk, JSON.stringify(guest.slice(0, SES_MAX)));
          localStorage.removeItem(gk);
          o.adopted = guest.length;
        }
      } catch (e) { /* ignore */ }
    }
    sessions = loadSessions();
    curId = null;
    renderAcctBtn();
    renderSessions();
    loadFish();
    renderFish();
    if (sessions.length && sessions[0].msgs && sessions[0].msgs.length) openSession(sessions[0].id);
    else { agent.clear_short_term(); $('chat').innerHTML = homeHTML; scrollBottom(); }
    return o;
  }

  function factLabel(k) {
    var d = (AP.DB && AP.DB.FACT_DEFS) || {};
    return (d[k] && d[k].label) || k;
  }
  function factText(k, v) {
    if (k === 'identityType' && window.AP_KB && AP_KB.identityTypes && AP_KB.identityTypes[v]) return AP_KB.identityTypes[v].name;
    if (k === 'employment') return v === 'self-employed' ? '自雇 / 自己开公司' : (v === 'employed' ? '受雇' : v);
    if (k === 'goal') return ({ pr: '拿永居', renewal: '续签', school: '择校 / 插班' })[v] || v;
    if (k === 'dependants') return v + ' 个孩子';
    return String(v);
  }
  function refreshProfile() {
    var d = db();
    if (!d) return;
    var u = d.auth.current();
    $('profWho').textContent = u ? ('已登录：' + (u.name || '') + ' · ' + u.email) : '未登录（档案存在本机访客空间）';
    var box = $('profList');
    box.textContent = '';
    d.profile.get().then(function (facts) {
      var keys = Object.keys(facts);
      if (!keys.length) {
        box.appendChild(el('p', 'hint', '还没有档案。去对话里说一句「我是高才B类，2025-09-01 激活，带 2 个孩子读中二」就会自动记下来。'));
        return;
      }
      keys.forEach(function (k) {
        var row = el('div', 'prof-row');
        row.appendChild(el('span', 'prof-k', factLabel(k)));
        row.appendChild(el('span', 'prof-v', factText(k, facts[k])));
        var x = el('button', 'prof-x', '✕');
        x.title = '清掉这一项';
        x.addEventListener('click', function () {
          d.profile.clear(k).then(function () { refreshProfile(); });
        });
        row.appendChild(x);
        box.appendChild(row);
      });
    });
  }

  /* 每轮用户消息后静默学习档案（确定性规则，不调模型） */
  function learnProfile(text) {
    var d = db();
    if (!d || !text) return;
    try {
      d.profile.learn(text).then(function (picked) {
        if (Object.keys(picked || {}).length && !$('authModal').hidden) refreshProfile();
      }, function () { /* 学不到就算了 */ });
    } catch (e) { /* ignore */ }
  }

  function initAuth() {
    if (!db()) { $('acctBtn').disabled = true; return; }
    renderAcctBtn();
    $('acctBtn').addEventListener('click', function () { openAuth(); });
    $('closeAuth').addEventListener('click', closeAuth);
    $('authModal').addEventListener('click', function (e) { if (e.target === $('authModal')) closeAuth(); });
    Array.prototype.forEach.call(document.querySelectorAll('.auth-tab'), function (b) {
      b.addEventListener('click', function () { authView(b.getAttribute('data-view')); });
    });

    $('viewLogin').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('loginEmail').value.trim(), pw = $('loginPw').value;
      if (!email || !pw) { setAuthMsg('邮箱和密码都要填。', 'bad'); return; }
      setAuthMsg('正在登录…');
      db().auth.login(email, pw).then(function (u) {
        var res = onAuthChanged({ adoptGuest: true });
        setAuthMsg('欢迎回来，' + (u.name || u.email) + '。' + (res.adopted ? '（已把本机 ' + res.adopted + ' 条对话收进你的账号）' : ''), 'ok');
        closeAuth();
        appendNotice('已登录：' + u.email + '。对话记录与档案现在跟着这个账号走' + (res.adopted ? '（原有 ' + res.adopted + ' 条对话已并入）' : '') + '。');
      }, function (err) { setAuthMsg(err.message || '登录失败', 'bad'); });
    });

    $('viewRegister').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('regEmail').value.trim(), pw = $('regPw').value, pw2 = $('regPw2').value, name = $('regName').value.trim();
      if (pw !== pw2) { setAuthMsg('两次密码不一致。', 'bad'); return; }
      if (pw.length < 8) { setAuthMsg('密码至少 8 位。', 'bad'); return; }
      setAuthMsg('正在创建…');
      db().auth.register(email, pw, name).then(function (u) {
        var res = onAuthChanged({ adoptGuest: true });
        var tips = ['账号已创建：' + u.email + '。'];
        if (res.adopted) tips.push('本机原有 ' + res.adopted + ' 条对话已并入。');
        db().profile.rebuild(sessions, readMemories()).then(function (p) {
          var n = Object.keys(p || {}).length;
          appendNotice(tips.join('') + (n ? '已从历史对话建立档案（' + n + ' 项）。' : '档案还是空的，聊两句就会自动填。'));
          refreshProfile();
        }, function () { appendNotice(tips.join('')); });
        closeAuth();
      }, function (err) { setAuthMsg(err.message || '注册失败', 'bad'); });
    });

    $('loginPhone').addEventListener('click', function () {
      db().auth.loginWithPhone('', '').then(null, function (err) {
        setAuthMsg(err.message + '（' + err.code + '）', 'bad');
      });
    });
    $('loginWeChat').addEventListener('click', function () {
      db().auth.loginWithWeChat({}).then(null, function (err) {
        setAuthMsg(err.message + '（' + err.code + '）', 'bad');
      });
    });

    $('doLogout').addEventListener('click', function () {
      db().auth.logout().then(function () {
        closeAuth();
        onAuthChanged({});
        appendNotice('已退出登录。当前进入访客空间（对话记录按账号隔离，不会丢）。');
      });
    });
    $('profRebuild').addEventListener('click', function () {
      $('profNote').textContent = '正在从历史对话重建…';
      db().profile.rebuild(sessions, readMemories()).then(function (p) {
        var n = Object.keys(p || {}).length;
        $('profNote').textContent = '重建完成：' + n + ' 项事实（以最近一次说法为准）。';
        refreshProfile();
      }, function (e) { $('profNote').textContent = '重建失败：' + (e.message || e); });
    });
  }

  function readMemories() {
    try { return AP.Store.get('ap:mem:semantic', []) || []; } catch (e) { return []; }
  }

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
    initTheme();
    initAuth();
    initFish();

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
      ['ap:mem:episodic', 'ap:mem:semantic', 'ap:mem:procedural', 'ap:vfs', SES_KEY, FISH_KEY, FISH_OPEN, scoped(SES_KEY), scoped(FISH_KEY)].forEach(function (k) { AP.Store.del(k); });
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

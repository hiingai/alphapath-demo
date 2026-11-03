/* AlphaPath · 留资管理后台（纯前端读本机 IndexedDB）
 * 数据来自 engine/leaddb.js（窗口 AP.Lead）；?demo=1 自动载入演示种子数据。
 */
(function () {
  'use strict';
  var L = window.AP && AP.Lead;
  var PALETTE = ['#2b7de0', '#12996a', '#b3760f', '#8b5cf6', '#d64545', '#0ea5b7', '#e2719b', '#7c8a99'];
  var state = { leads: [], rows: [], q: '', stage: '', sort: 'intent', cur: null };
  var MODE = 'local';            /* local = 本机库；live = 服务端汇总库 */
  var API = String(window.AP_SYNC_BASE || '').replace(/\/+$/, '');

  function jfetch(p, opts) {
    var h = { 'content-type': 'application/json' };
    var tk = '';
    try { tk = sessionStorage.getItem('ap:admin:token') || ''; } catch (e) { }
    if (tk) h.authorization = 'Bearer ' + tk;
    return fetch(API + p, Object.assign({ credentials: 'same-origin', headers: h }, opts || {}))
      .then(function (r) {
        if (r.status === 401) { var e = new Error('unauthorized'); e.code = 401; throw e; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function identityName(k) {
    if (!k) return '待确认';
    var t = window.AP_KB && AP_KB.identityTypes && AP_KB.identityTypes[k];
    return t ? t.name : k;
  }
  function goalName(k) { return (L.GOAL_LABEL && L.GOAL_LABEL[k]) || (k ? k : '待确认'); }
  function empName(k) { return (L.EMP_LABEL && L.EMP_LABEL[k]) || (k || '—'); }
  function stageName(k) { return (L.STAGE_LABEL && L.STAGE_LABEL[k]) || k || '—'; }
  function d2(iso) { return iso ? String(iso).slice(0, 10) : '—'; }
  function ago(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    if (isNaN(t)) return '—';
    var days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 30) return days + ' 天前';
    return Math.floor(days / 30) + ' 个月前';
  }
  function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

  /* ---------------- 载入 ---------------- */
  function load() {
    if (MODE === 'live') {
      return jfetch('/_api/admin/leads?limit=200')
        .then(function (j) {
          state.leads = (j.rows || []).map(function (r) { return Object.assign({}, r, { id: r.lead_id, facts: r.facts || [] }); });
          $('demoBanner').hidden = true;
          $('modeTag').textContent = '汇总库 · ' + state.leads.length + ' 条';
          $('modeTag').className = 'mode live';
          renderAll();
        })
        .catch(function (e) {
          if (e.code === 401) { $('login').hidden = false; return; }
          $('modeTag').textContent = '汇总服务出错';
        });
    }
    if (!L) { $('empty').hidden = false; $('empty').textContent = '留资模块未加载（engine/leaddb.js 缺失）。'; return; }
    L.all().then(function (list) {
      state.leads = list || [];
      var hasDemo = state.leads.some(function (l) { return l.demo; });
      $('demoBanner').hidden = !hasDemo;
      $('modeTag').textContent = '本机模式 · ' + state.leads.length + ' 条';
      renderAll();
    });
  }

  function renderAll() {
    var s = L.stats(state.leads);
    renderKpis(s);
    renderFunnel(s);
    renderDonut(s);
    renderGoals(s);
    renderTrend(s);
    applyFilter();
  }

  /* ---------------- 指标 ---------------- */
  function renderKpis(s) {
    var qualifiedPlus = (s.byStage.qualified || 0) + (s.byStage.contacted || 0) + (s.byStage.consulting || 0) + (s.byStage.converted || 0);
    var cards = [
      { k: '线索总数', v: s.n, d: '去重后（邮箱/账号指纹）', cls: '' },
      { k: '留资率', v: s.leadRate + '%', d: '关键字段 ≥3/4 的占比', cls: 'hot' },
      { k: '高意向 ≥70', v: s.hot, d: '可直接交顾问跟进', cls: 'good' },
      { k: '合格及以上', v: qualifiedPlus, d: '身份+激活日齐且分数达标', cls: '' },
      { k: '平均轮次', v: s.avgTurns, d: '人均对话轮次（粘性）', cls: '' },
      { k: '平均完整度', v: s.avgComp + '%', d: '线索信息齐全程度', cls: '' }
    ];
    $('kpis').innerHTML = cards.map(function (c) {
      return '<div class="kpi ' + c.cls + '"><div class="k">' + esc(c.k) + '</div>' +
        '<div class="v">' + esc(String(c.v)) + '</div><div class="d">' + esc(c.d) + '</div></div>';
    }).join('');
  }

  function renderFunnel(s) {
    var max = Math.max(1, s.byStage.visitor || 0, s.byStage.registered || 0, s.byStage.qualified || 0,
      s.byStage.contacted || 0, s.byStage.consulting || 0, s.byStage.converted || 0);
    $('funnel').innerHTML = s.funnel.map(function (f) {
      return '<div class="fn"><span class="lb">' + esc(f.label) + '</span>' +
        '<span class="bar"><i style="width:' + Math.max(2, pct(f.n, max)) + '%"></i></span>' +
        '<span class="n">' + f.n + '</span></div>';
    }).join('');
    $('funnelHint').textContent = s.n ? ('合格率 ' + s.qualificationRate + '%　·　状态由规则自动判定，人工阶段不回退') : '暂无数据';
  }

  function mix(obj, limit) {
    var arr = Object.keys(obj).map(function (k) { return { k: k, n: obj[k] }; })
      .sort(function (a, b) { return b.n - a.n; });
    if (limit && arr.length > limit) {
      var rest = arr.slice(limit).reduce(function (a, x) { return a + x.n; }, 0);
      arr = arr.slice(0, limit);
      if (rest) arr.push({ k: '__other', n: rest });
    }
    return arr;
  }

  function renderDonut(s) {
    var arr = mix(s.byIdentity, 5);
    var total = arr.reduce(function (a, x) { return a + x.n; }, 0) || 1;
    var acc = 0, stops = [];
    arr.forEach(function (x, i) {
      var from = (acc / total) * 100, to = ((acc + x.n) / total) * 100;
      stops.push(PALETTE[i % PALETTE.length] + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%');
      acc += x.n;
    });
    if (!arr.length) stops = ['var(--inset) 0 100%'];
    $('donut').style.background = 'conic-gradient(' + stops.join(',') + ')';
    $('donutCenter').innerHTML = s.n + '<i>人</i>';
    $('legend').innerHTML = arr.map(function (x, i) {
      var name = x.k === '__other' ? '其他' : identityName(x.k === 'unknown' ? '' : x.k);
      return '<li><i style="background:' + PALETTE[i % PALETTE.length] + '"></i>' + esc(name) +
        '<b>' + x.n + '</b></li>';
    }).join('') || '<li>暂无数据</li>';
  }

  function renderGoals(s) {
    var arr = mix(s.byGoal, 6);
    var max = Math.max(1, arr.length ? arr[0].n : 1);
    $('goalBars').innerHTML = arr.map(function (x) {
      var name = x.k === 'unknown' ? '待确认' : (x.k === '__other' ? '其他' : goalName(x.k));
      return '<div class="bl"><span class="lb">' + esc(name) + '</span>' +
        '<span class="tr"><i style="width:' + Math.max(2, pct(x.n, max)) + '%"></i></span>' +
        '<span class="n">' + x.n + '</span></div>';
    }).join('') || '<p class="empty">暂无数据</p>';
  }

  function renderTrend(s) {
    var days = [], map = {};
    (s.trend || []).forEach(function (t) { map[t.day] = t.n; });
    for (var i = 13; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push({ day: d, n: map[d] || 0 });
    }
    var W = 520, H = 130, P = 16;
    var max = Math.max(1, Math.max.apply(null, days.map(function (d) { return d.n; })));
    var step = (W - P * 2) / Math.max(1, days.length - 1);
    var pts = days.map(function (d, i) {
      var x = P + i * step, y = H - P - (d.n / max) * (H - P * 2 - 10);
      return { x: x, y: y, n: d.n, day: d.day };
    });
    var line = pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var area = 'M' + pts[0].x.toFixed(1) + ',' + (H - P) + ' L' + line.replace(/ /g, ' L') + ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (H - P) + ' Z';
    var dots = pts.map(function (p) { return '<circle class="pt" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"></circle>'; }).join('');
    var xlabels = pts.filter(function (p, i) { return i % 3 === 0; }).map(function (p) {
      return '<text class="xl" x="' + p.x.toFixed(1) + '" y="' + (H - 3) + '" text-anchor="middle">' + p.day.slice(5) + '</text>';
    }).join('');
    $('trend').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="近 14 天新增线索">' +
      '<line class="axis" x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '"></line>' +
      '<path class="area" d="' + area + '"></path>' +
      '<polyline class="line" points="' + line + '"></polyline>' + dots + xlabels + '</svg>';
  }

  /* ---------------- 列表 ---------------- */
  function applyFilter() {
    var q = state.q.trim().toLowerCase();
    var rows = state.leads.filter(function (l) {
      if (state.stage && l.stage !== state.stage) return false;
      if (!q) return true;
      var hay = [l.display_name, identityName(l.identity_type), goalName(l.goal), l.contact_email, l.school_stage, l.summary].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var sorters = {
      intent: function (a, b) { return (b.intent_score || 0) - (a.intent_score || 0); },
      recent: function (a, b) { return String(b.last_active_at).localeCompare(String(a.last_active_at)); },
      complete: function (a, b) { return (b.completeness || 0) - (a.completeness || 0); }
    };
    rows.sort(sorters[state.sort] || sorters.intent);
    state.rows = rows;
    renderTable(rows);
  }

  function renderTable(rows) {
    $('leadCount').textContent = rows.length + ' / ' + state.leads.length;
    $('empty').hidden = rows.length > 0;
    $('tbl').hidden = rows.length === 0;
    $('tbody').innerHTML = rows.map(function (l, i) {
      var clip = function (v) { return '<span class="tag st-' + esc(l.stage) + '">' + esc(stageName(l.stage)) + '</span>'; };
      return '<tr data-i="' + i + '">' +
        '<td><b>' + esc(l.display_name || '访客') + '</b>' + (l.demo ? '<span class="tag demo">DEMO</span>' : '') + '</td>' +
        '<td>' + esc(identityName(l.identity_type)) + '</td>' +
        '<td>' + esc(goalName(l.goal)) + '</td>' +
        '<td class="num">' + (l.dependants ? esc(l.dependants + ' 名') : '—') + '</td>' +
        '<td class="num"><span class="mini"><i style="width:' + Math.max(2, l.completeness || 0) + '%"></i></span>' + (l.completeness || 0) + '%</td>' +
        '<td class="num">' + (l.intent_score || 0) + '</td>' +
        '<td>' + clip() + '</td>' +
        '<td class="num">' + (l.n_turns || 0) + '</td>' +
        '<td>' + esc(ago(l.last_active_at)) + '</td>' +
        '</tr>';
    }).join('');
    Array.prototype.forEach.call($('tbody').querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () {
        var l = state.rows[Number(tr.getAttribute('data-i'))];
        if (l) openDrawer(l);
      });
    });
  }

  /* ---------------- 详情抽屉 ---------------- */
  function openDrawer(lead) {
    state.cur = lead;
    var body = $('drawerBody');
    var facts = (lead.facts || []);
    var factHtml = facts.length ? facts.map(function (f) {
      var val = f.key === 'identityType' ? identityName(f.value)
        : f.key === 'goal' ? goalName(f.value)
          : f.key === 'employment' ? empName(f.value)
            : f.key === 'dependants' ? (f.value + ' 名') : String(f.value);
      return '<div class="dr-f"><span class="k">' + esc(f.label || f.key) + '</span><span class="v">' + esc(val) +
        (f.evidence ? '<span class="ev">「' + esc(f.evidence) + '」· 来源 ' + esc(f.source || '对话') + '</span>' : '') +
        '</span></div>';
    }).join('') : '<p class="hint">还没有结构化字段，去对话里说两句就会自动出现。</p>';

    var tl = [];
    tl.push({ at: lead.first_seen_at, t: '首次进入', d: '来源：对话' });
    facts.forEach(function (f) { tl.push({ at: f.updated_at, t: '记录 ' + (f.label || f.key), d: String(f.value) }); });
    if (lead.consent_at) tl.push({ at: lead.consent_at, t: '同意联系', d: 'scope=' + (lead.consent_scope || 'contact') });
    tl.push({ at: lead.last_active_at, t: '最近活跃', d: (lead.n_turns || 0) + ' 轮 · ' + (lead.n_sessions || 0) + ' 个会话' });
    tl = tl.filter(function (x) { return x.at; }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

    var stageOpts = L.STAGES.map(function (s) {
      return '<option value="' + s + '"' + (s === lead.stage ? ' selected' : '') + '>' + esc(stageName(s)) + '</option>';
    }).join('');

    body.innerHTML =
      '<h3 class="dr-name">' + esc(lead.display_name || '访客') + (lead.demo ? '<span class="tag demo">DEMO</span>' : '') + '</h3>' +
      '<p class="dr-sub">' + esc(identityName(lead.identity_type)) + ' · 激活日 ' + esc(lead.activation_date || '未提供') +
      ' · 受养人 ' + (lead.dependants || '—') + ' · 最近活跃 ' + esc(ago(lead.last_active_at)) + '</p>' +
      '<div class="meter"><span>完整度</span><span class="tr"><i style="width:' + Math.max(2, lead.completeness || 0) + '%"></i></span><b>' + (lead.completeness || 0) + '%</b></div>' +
      '<div class="meter"><span>意向分</span><span class="tr"><i style="width:' + Math.max(2, lead.intent_score || 0) + '%"></i></span><b>' + (lead.intent_score || 0) + '</b></div>' +
      '<h4 class="sec">结构化字段（对话抽取）</h4><div class="dr-facts">' + factHtml + '</div>' +
      (lead.summary ? '<h4 class="sec">摘要</h4><p class="hint">' + esc(lead.summary) + '</p>' : '') +
      '<h4 class="sec">时间线</h4><ul class="tl">' + tl.map(function (x) {
        return '<li><b>' + esc(x.t) + '</b>　' + esc(d2(x.at)) + '<br>' + esc(x.d) + '</li>';
      }).join('') + '</ul>' +
      '<h4 class="sec">跟进</h4>' +
      '<div class="dr-act"><select id="drStage">' + stageOpts + '</select>' +
      '<button class="btn ghost" id="drSave">保存阶段</button></div>' +
      '<div class="dr-act" style="margin-top:8px"><textarea id="drNote" placeholder="跟进备注（只存在本机）">' + esc(lead.note || '') + '</textarea></div>' +
      '<div class="dr-act" style="margin-top:8px"><button class="btn ghost" id="drSaveNote">保存备注</button>' +
      '<button class="btn ghost" id="drDel">删除这条线索</button></div>' +
      '<h4 class="sec">私有信息</h4><p class="hint">联系方式：' + esc(lead.contact_email || '未授权记录') +
      '　·　同意时间：' + esc(lead.consent_at ? d2(lead.consent_at) : '未同意') + '</p>';

    $('drawer').hidden = false;
    $('drSave').addEventListener('click', function () {
      var st = $('drStage').value;
      var done = function () { $('drawer').hidden = true; load(); };
      if (MODE === 'live') {
        jfetch('/_api/admin/leads/' + lead.lead_id, { method: 'PATCH', body: JSON.stringify({ stage: st }) })
          .then(done).catch(function () { alert('保存失败（登录可能已过期）'); });
        return;
      }
      lead.stage = st;
      L.put(lead).then(done);
    });
    $('drSaveNote').addEventListener('click', function () {
      var note = $('drNote').value.slice(0, 500);
      var done = function () { $('drawer').hidden = true; load(); };
      if (MODE === 'live') {
        jfetch('/_api/admin/leads/' + lead.lead_id, { method: 'PATCH', body: JSON.stringify({ note: note }) })
          .then(done).catch(function () { alert('保存失败（登录可能已过期）'); });
        return;
      }
      lead.note = note;
      L.put(lead).then(done);
    });
    $('drDel').addEventListener('click', function () {
      if (!confirm('删除「' + (lead.display_name || '访客') + '」这条线索？')) return;
      if (MODE === 'live') {
        jfetch('/_api/admin/leads/' + lead.lead_id + '/delete', { method: 'POST' })
          .then(function () { $('drawer').hidden = true; load(); })
          .catch(function () { alert('删除失败'); });
        return;
      }
      L.remove(lead.id).then(function () { $('drawer').hidden = true; load(); });
    });
  }

  /* ---------------- 导出 ---------------- */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 600);
  }

  /* ---------------- 主题 ---------------- */
  function applyTheme(mode) {
    var t = mode === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('ap:theme', t); } catch (e) { }
    $('btnTheme').textContent = t === 'dark' ? '☀️ 浅色' : '🌙 深色';
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    applyTheme(localStorage.getItem('ap:theme') === 'dark' ? 'dark' : 'light');
    $('btnTheme').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    $('btnRefresh').addEventListener('click', load);
    $('btnExport').addEventListener('click', function () {
      if (MODE === 'live') {
        var qs = '?limit=200' + (state.stage ? '&stage=' + encodeURIComponent(state.stage) : '') + (state.q ? '&q=' + encodeURIComponent(state.q) : '');
        window.open(API + '/_api/admin/export.csv' + qs, '_blank');
        return;
      }
      var rows = state.rows.length ? state.rows : state.leads;
      download('alphapath-leads-' + new Date().toISOString().slice(0, 10) + '.csv', L.toCsv(rows));
    });
    $('btnDemo').addEventListener('click', function () {
      if (MODE === 'live') { alert('当前连接的是汇总库；演示数据请用 admin.html?demo=1 查看。'); return; }
      L.seedDemo(36).then(function (r) {
        $('demoBanner').hidden = false;
        load();
        $('funnelHint').textContent = '已生成 ' + r.added + ' 条演示线索';
      });
    });
    $('btnClearDemo').addEventListener('click', function () {
      L.clearDemo().then(function () { $('demoBanner').hidden = true; load(); });
    });
    $('q').addEventListener('input', function () { state.q = this.value; applyFilter(); });
    $('stageSel').addEventListener('change', function () { state.stage = this.value; applyFilter(); });
    $('sortSel').addEventListener('change', function () { state.sort = this.value; applyFilter(); });
    $('drawerX').addEventListener('click', function () { $('drawer').hidden = true; });
    $('drawer').addEventListener('click', function (e) { if (e.target === $('drawer')) $('drawer').hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('drawer').hidden = true; });

    $('stageSel').innerHTML = '<option value="">全部阶段</option>' + L.STAGES.map(function (s) {
      return '<option value="' + s + '">' + esc(stageName(s)) + '</option>';
    }).join('');

    fetch('version.json?_=' + Date.now()).then(function (r) { return r.json(); }).then(function (v) {
      $('build').textContent = 'build ' + v.build;
    }).catch(function () { });

    var demo = /(\?|&)demo=1/.test(location.search);
    var loginForm = $('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        $('lgErr').hidden = true;
        fetch(API + '/_api/admin/login', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user: $('lgUser').value, pass: $('lgPass').value })
        }).then(function (r) {
          if (!r.ok) throw new Error('bad');
          return r.json();
        }).then(function (j) {
          try { if (j && j.token) sessionStorage.setItem('ap:admin:token', j.token); } catch (e) { }
          $('login').hidden = true;
          load();
        }).catch(function () {
          $('lgErr').textContent = '账号或密码不正确';
          $('lgErr').hidden = false;
        });
      });
    }
    if (demo) {
      MODE = 'local';
      L.all().then(function (list) {
        if (list.some(function (l) { return l.demo; })) { load(); return; }
        L.seedDemo(36).then(function () { load(); });
      });
      return;
    }
    /* 先问汇总服务在不在：在 → 真库（需登录）；不在 → 本机库 */
    fetch(API + '/_api/health', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok && j.db) { MODE = 'live'; $('btnDemo').hidden = true; load(); }
        else { MODE = 'local'; load(); }
      })
      .catch(function () { MODE = 'local'; $('modeTag').textContent = '本机模式（未连接汇总服务）'; load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

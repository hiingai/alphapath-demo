/* AlphaPath · 工具注册表（移植自 v1.4 agent/tools.py + sandbox.py）
 * 16 个工具；统一 call(name,arg)->string，异常返回 "__ERROR__:" 前缀。
 * 浏览器差异：read_file/write_file/list_dir 走 IndexedDB/localStorage 虚拟 FS；
 *            run_command 无 shell（明确提示，不用 __ERROR__ 冒充成功）。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});
  var KB = global.AP_KB;
  var ERR_PREFIX = '__ERROR__:';
  var FILE_MAX_BYTES = 1024 * 1024;
  var VFS_KEY = 'ap:vfs';

  function fail(msg) { return ERR_PREFIX + msg; }

  /* Python f-string 里 True/False 是大写，保持一致 */
  function pyStr(v) {
    if (v === true) return 'True';
    if (v === false) return 'False';
    return String(v);
  }

  function parseKV(arg) {
    arg = String(arg == null ? '' : arg).trim();
    if (!arg) return {};
    if (arg.charAt(0) === '{') {
      try {
        var parsed = JSON.parse(arg);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        return { _json: parsed };
      } catch (e) { /* fallthrough */ }
    }
    if (arg.charAt(0) === '[') {
      try { return { _positional: JSON.parse(arg) }; } catch (e) { /* fallthrough */ }
    }
    var out = {};
    arg.split(/[\s,;]+/).forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    });
    return out;
  }

  function jsonList(raw) {
    if (Array.isArray(raw)) return raw;
    try {
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  /* ---------------- 虚拟文件系统 ---------------- */
  var VFS = (function () {
    function load() {
      var raw = AP.Store.get(VFS_KEY);
      if (!raw) return { 'notes/README.md': '# 沙箱说明\n这是浏览器版虚拟文件系统（存在 localStorage）。\n' };
      try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
    }
    function save(m) { try { AP.Store.set(VFS_KEY, JSON.stringify(m)); } catch (e) { /* 配额满 */ } }
    function norm(path) {
      return String(path || '.').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    }
    return { load: load, save: save, norm: norm };
  })();

  function read_file(path) {
    var m = VFS.load(), p = VFS.norm(path);
    if (p === '' || p === '.' || /\/$/.test(p)) return '这是一个目录，请用 list_dir：' + path;
    if (!(p in m)) return '文件不存在：' + path;
    var content = m[p];
    if (content.length > FILE_MAX_BYTES) return '文件过大（>' + FILE_MAX_BYTES + ' 字节）';
    return '【文件内容】' + p + '\n\n' + content;
  }
  function write_file(arg) {
    var parts = String(arg || '').split('|||');
    if (parts.length < 2) return fail('参数格式应为：路径|||内容');
    var path = VFS.norm(parts[0]);
    var content = parts.slice(1).join('|||');
    if (!path) return fail('路径不能为空');
    var m = VFS.load();
    m[path] = content;
    VFS.save(m);
    return '已写入文件：' + parts[0].trim() + '（' + content.length + ' 字符）';
  }
  function list_dir(path) {
    var m = VFS.load(), p = VFS.norm(path);
    if (p === '.') p = '';
    var entries = {}, keys = Object.keys(m);
    var prefix = p ? p.replace(/\/$/, '') + '/' : '';
    var any = false;
    keys.forEach(function (k) {
      if (prefix && k.indexOf(prefix) !== 0) return;
      any = true;
      var rest = k.slice(prefix.length);
      var seg = rest.split('/')[0];
      if (rest.indexOf('/') >= 0) entries[seg] = { dir: true };
      else entries[seg] = { dir: false, size: m[k].length };
    });
    if (!any) return '目录不存在：' + (path || '.');
    var lines = ['【目录】' + (prefix || '/')];
    Object.keys(entries).sort().forEach(function (name) {
      if (entries[name].dir) lines.push('  [DIR] ' + name);
      else lines.push('  [FILE] ' + name + ' (' + entries[name].size + ' B)');
    });
    return lines.join('\n');
  }
  function run_command(command) {
    if (!String(command || '').trim()) return '命令不能为空。';
    return '浏览器版不提供 shell 执行（无进程环境）：' + command
      + '\n该能力仅在本地版（python run.py）可用。';
  }

  /* ---------------- 计算器（受限表达式解析，Python 语义） ---------------- */
  function tokenizeExpr(s) {
    var out = [], i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === ' ') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        var j = i;
        while (j < s.length && /[0-9.]/.test(s.charAt(j))) j++;
        out.push({ t: 'num', v: s.slice(i, j) });
        i = j;
        continue;
      }
      if (s.substr(i, 2) === '**') { out.push({ t: 'op', v: '**' }); i += 2; continue; }
      if ('+-*/%()'.indexOf(c) >= 0) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new Error('不支持的表达式');
    }
    return out;
  }
  function evalExpr(src) {
    var tk = tokenizeExpr(src), pos = 0;
    function peek() { return tk[pos]; }
    function eat(v) {
      var t = tk[pos];
      if (!t || t.v !== v) throw new Error('不支持的表达式');
      pos++;
      return t;
    }
    function primary() {
      var t = tk[pos];
      if (!t) throw new Error('不支持的表达式');
      if (t.t === 'op' && t.v === '(') { pos++; var v = expr(); eat(')'); return v; }
      if (t.t === 'num') {
        pos++;
        var num = parseFloat(t.v);
        if (isNaN(num)) throw new Error('仅支持数字');
        return { v: num, f: t.v.indexOf('.') >= 0 };
      }
      if (t.t === 'op' && t.v === '-') { pos++; var u = unary(); return { v: -u.v, f: u.f }; }
      if (t.t === 'op' && t.v === '+') { pos++; return unary(); }
      throw new Error('不支持的表达式');
    }
    function power() {
      var base = primary();
      var t = tk[pos];
      if (t && t.t === 'op' && t.v === '**') {
        pos++;
        var exp = unary();
        var val = Math.pow(base.v, exp.v);
        var isFloat = base.f || exp.f || exp.v < 0 || !Number.isInteger(exp.v);
        return { v: val, f: isFloat };
      }
      return base;
    }
    function unary() {
      var t = tk[pos];
      if (t && t.t === 'op' && t.v === '-') { pos++; var u = unary(); return { v: -u.v, f: u.f }; }
      if (t && t.t === 'op' && t.v === '+') { pos++; return unary(); }
      return power();
    }
    function term() {
      var left = unary();
      while (tk[pos] && tk[pos].t === 'op' && '*/%'.indexOf(tk[pos].v) >= 0 && tk[pos].v !== '**') {
        var op = tk[pos].v; pos++;
        var right = unary();
        if (op === '*') left = { v: left.v * right.v, f: left.f || right.f };
        else if (op === '/') {
          if (right.v === 0) throw new Error('division by zero');
          left = { v: left.v / right.v, f: true };
        } else {
          if (right.v === 0) throw new Error('modulo by zero');
          left = { v: left.v % right.v, f: left.f || right.f };
        }
      }
      return left;
    }
    function expr() {
      var left = term();
      while (tk[pos] && tk[pos].t === 'op' && (tk[pos].v === '+' || tk[pos].v === '-')) {
        var op = tk[pos].v; pos++;
        var right = term();
        left = { v: op === '+' ? left.v + right.v : left.v - right.v, f: left.f || right.f };
      }
      return left;
    }
    var res = expr();
    if (pos !== tk.length) throw new Error('不支持的表达式');
    return res;
  }
  function fmtNum(x) {
    if (x.f) return Number.isInteger(x.v) ? x.v.toFixed(1) : String(x.v);
    return String(x.v);
  }
  function calculator(expression) {
    var expr = String(expression == null ? '' : expression).trim().split('^').join('**');
    if (!expr) return fail('表达式为空');
    if (!/^[0-9+\-*/(). %]+$/.test(expr)) return fail('表达式包含非法字符');
    try {
      var r = evalExpr(expr);
      return '计算结果：' + expr + ' = ' + fmtNum(r);
    } catch (e) {
      var msg = (e && e.message) ? e.message : String(e);
      if (msg === '不支持的表达式' || msg === '仅支持数字') msg = 'invalid syntax (<unknown>, line 1)';
      return fail('计算失败：' + msg);
    }
  }

  /* ---------------- 时间 ---------------- */
  function get_time() {
    var d = new Date();
    var wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    function p2(n) { return n < 10 ? '0' + n : '' + n; }
    return '当前时间：' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' '
      + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + ' ' + wd[d.getDay()];
  }

  /* ---------------- 领域工具 ---------------- */
  function legal_profile(arg) {
    var p = parseKV(arg);
    var identity_type = p.identityType || p.it || p.type;
    if (!identity_type) return fail('需要参数 identityType，例如 identityType=ESLS');
    var segments = typeof p.segments === 'string' ? jsonList(p.segments) : (p.segments || []);
    if (!Array.isArray(segments)) segments = [];
    var profile = AP.legal.legal_profile_of({ identityType: identity_type, segments: segments });
    var it = KB.identityTypes[identity_type];
    if (!it) return fail('未知身份类型：' + identity_type);
    var lines = ['【法定资格剖面】' + it.name + '（tier=' + profile.tier + '，canPr=' + pyStr(profile.canPr) + '）'];
    if (profile.denials.length) {
      profile.denials.forEach(function (d) {
        lines.push('- ① DENY｜' + d.id + '｜依据：' + d.legal_basis
          + (d.precedent ? '｜先例：' + d.precedent : ''));
      });
      lines.push('- 提示：2025 年起 GEP/ASMTP 下新增的「非学位专才」渠道属正常层、可累积在港居住年数并可申请永居，'
        + '与输入劳工/外籍家庭佣工有本质区别（耦合 C15），请勿混淆。');
    }
    if (profile.dwells.length) {
      profile.dwells.forEach(function (d) {
        lines.push('- ② DWELL｜' + d.id + '｜' + d.calc_hint + '（服务入口正常开放）');
      });
    }
    if (profile.conds.length) {
      profile.conds.forEach(function (c) {
        lines.push('- ③ COND｜' + c.id + '｜' + c.reminder);
        if (c.dual_basis) {
          c.dual_basis.forEach(function (b) { lines.push('    · ' + b.label + '：' + b.text); });
        }
        if (c.pending_legal_review || c.rule_ref) {
          var ref = c.rule_ref || '';
          lines.push('    · 状态：待法务确认'
            + (ref ? '（未闭合分歧 ' + ref + '，须外部法律顾问裁决后方可统一口径）' : ''));
        }
        if (c.monitor) {
          lines.push('    · 监控：保证人到期前 ' + c.monitor.guardian_expiry_alert_days + ' 天提醒');
        }
      });
    }
    profile.notices.forEach(function (n) {
      if (n.tier === 'deny') {
        var rm = (n.remedies || []).map(function (r) { return r.label; }).join('、');
        lines.push('- ⛔ ' + n.title + '｜合规替代路径：' + rm);
      }
    });
    lines.push('以上为法律事实陈述，非审批承诺；具体以入境事务处认定为准。');
    return lines.join('\n');
  }

  function compute_timeline(arg) {
    var p = parseKV(arg);
    var identity_type = p.identityType || p.visa_type || p.type;
    var activation = p.activationDate || p.activation_date || p.grant_date;
    if (!identity_type || !activation) {
      return fail('需要参数 identityType 与 activationDate，例如 identityType=TTPS_A activationDate=2023-09-01');
    }
    var t;
    try { t = AP.timeline.compute_visa_timeline(identity_type, activation); } catch (e) {
      return fail(e && e.message ? e.message : String(e));
    }
    var lines = ['【7 年主航道】' + t.identityName + '（tier=' + t.tier + '，规则版本 ' + t.ruleVersion + '）',
      '- 激活：' + t.activation + '｜首签到期：' + t.expiry,
      '- 递交窗口：' + t.applyWindow.start + ' ~ ' + t.applyWindow.deadline
        + (t.isPeak ? '（6–8 月高峰，建议提前递交）' : ''),
      '- 建议递交：' + t.suggestedSubmitBy,
      '- 7 年届满：' + (t.canPr ? t.prDate : '不适用（该身份不产生永居路径）'),
      '- 费用：申请 ' + (t.fees.application / 100).toFixed(0) + ' 港元 + 签发 ' + (t.fees.issuance / 100).toFixed(0) + ' 港元'];
    (t.rounds || []).forEach(function (r) {
      lines.push('- 第 ' + r.index + ' 轮（' + r.kind + '）：到期 ' + r.expiry + '；窗口 '
        + r.windowStart + ' ~ ' + r.windowDeadline + '；建议 ' + r.suggestedSubmitBy);
    });
    if (t.specialNotice) lines.push('- 特别提示：' + t.specialNotice);
    return lines.join('\n');
  }

  function compute_dwell(arg) {
    var p = parseKV(arg);
    var raw = p.segments, segments;
    if (typeof raw === 'string') segments = jsonList(raw);
    else if (Array.isArray(raw)) segments = raw;
    else if (Array.isArray(p._positional)) segments = p._positional;
    else segments = [];
    if (!segments.length) {
      return fail('需要参数 segments，例如 {"segments":[{"kind":"visa","start":"2023-09-01","end":"2026-09-01"}]}');
    }
    var as_of = p.as_of || p.asOf;
    var res;
    try { res = AP.timeline.compute_dwell(segments, as_of); } catch (e) {
      return fail('居住年限计算失败：' + (e && e.message ? e.message : e));
    }
    var lines = ['【居住年限】截至 ' + res.asOf + '｜计入 ' + res.creditedDays + ' 天（约 '
      + res.creditedYears + ' 年 ' + res.creditedMonths + ' 个月）',
      '- 7 年进度：' + (res.progress * 100).toFixed(1) + '%'];
    res.exclusions.forEach(function (ex) {
      var effect = { exclude: '不计入', rebase: '不计入并重新起算', exclude_flagged: '不计入（已标记）' }[ex.effect] || ex.effect;
      lines.push('- [' + ex.ruleId + '] ' + ex.kind + '：' + effect + '（' + ex.days + ' 天）');
    });
    if (res.rebasedFrom) lines.push('- 重新起算点：' + res.rebasedFrom + '（连续性中断）');
    if (res.dualRequired) {
      var a = res.dual.baseA, b = res.dual.baseB;
      lines.push('- 双口径并列：' + a.label + ' ' + a.years + ' 年 / ' + b.label + ' ' + b.years + ' 年（须专业顾问复核）');
    }
    lines.push('- 通常居住为综合判定，非天数硬指标；服务入口正常开放。');
    return lines.join('\n');
  }

  function check_compliance(arg) {
    var p = parseKV(arg);
    if (!Object.keys(p).length) {
      return fail('参数为空，示例：applicantInHk=true employer.registeredMonths=3 mpfMonths=2 declaredSalaryMonths=6');
    }
    var data = {}, nested = {};
    Object.keys(p).forEach(function (k) {
      if (k === '_positional') return;
      var v = p[k];
      if (typeof v === 'string') {
        var vl = v.toLowerCase();
        if (vl === 'true' || vl === 'false') v = (vl === 'true');
        else if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
      }
      if (k.indexOf('.') >= 0) {
        var idx = k.indexOf('.');
        var head = k.slice(0, idx), sub = k.slice(idx + 1);
        nested[head] = nested[head] || {};
        nested[head][sub] = v;
      } else {
        data[k] = v;
      }
    });
    Object.keys(nested).forEach(function (k) { data[k] = nested[k]; });
    var report = AP.compliance.check_compliance(data);
    var lines = ['【合规自检】结果：' + report.result + '（置信度 ' + report.confidence + '）'];
    report.findings.forEach(function (f) {
      var extra = (f.signals && f.signals.length) ? '｜信号：' + f.signals.join('、') : '';
      lines.push('- [' + f.severity + '] ' + f.code + '：' + (f.suggestion || '') + extra
        + (f.basisRef ? '（依据 ' + f.basisRef + '）' : ''));
    });
    if (!report.findings.length) lines.push('- 未命中红线。');
    lines.push('- 处理建议：' + report.decision + '（BLOCK 须人工解除）');
    return lines.join('\n');
  }

  /* ---------------- 生成文件（清单 / 表格 → 可勾选的 HTML） ---------------- */
  var CHECKLIST_PRESETS = {
    renew: {
      title: '续签材料清单',
      items: ['有效旅行证件（含现时签证标签）', '雇佣合同 / 聘用书（注明职位与薪酬）',
        '薪俸税评税通知书或报税表', '强积金供款记录', '住址证明（租约 + 最近一期水电煤单）',
        '公司商业登记证（自雇适用）', '公司审计报告 / 银行流水（自雇适用）', '学历证书与专业资格证明']
    },
    student: {
      title: '学生签证材料清单',
      items: ['有效旅行证件', '院校录取通知书 / 在读证明', '学费缴付收据',
        '住宿安排证明', '经济能力证明（存款或担保）', '学历与语言成绩证明']
    },
    rop145: {
      title: 'ROP145 永居核实材料清单',
      items: ['ROP145 申请表', '有效旅行证件与历年签证标签', '在港通常居住证明（租约／水电单／税单）',
        '受雇证明 / 强积金记录', '配偶与子女关系证明（如适用）', '连续离港超过 6 个月的说明（如有）']
    }
  };

  function pick_preset(text) {
    var t = String(text || '');
    if (/(ROP145|永居|永久)/.test(t)) return CHECKLIST_PRESETS.rop145;
    if (/(学生|读书|院校|升学)/.test(t)) return CHECKLIST_PRESETS.student;
    return CHECKLIST_PRESETS.renew;
  }

  function parseFileArg(arg) {
    var s = String(arg == null ? '' : arg).trim(), o = {};
    if (s.charAt(0) === '{') {
      try { o = JSON.parse(s) || {}; } catch (e) { o = {}; }
    }
    if (!Object.keys(o).length) {
      s.split(/[\n;]+/).forEach(function (line) {
        var i = line.indexOf('=');
        if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
    }
    var items = o.items;
    if (typeof items === 'string') items = items.split(/\s*[|｜、]\s*|\s*,\s*/);
    if (!Array.isArray(items)) items = [];
    items = items.map(function (x) { return String(x).trim(); }).filter(Boolean);
    return {
      kind: String(o.kind || 'checklist'),
      title: String(o.title || o.name || '续签材料清单'),
      items: items.slice(0, 60),
      note: String(o.note || '')
    };
  }

  function slugify(s) {
    return String(s || 'file').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
  }

  function build_checklist_html(title, items, note) {
    var esc = function (x) {
      return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    var key = 'ap-checklist:' + slugify(title);
    var li = items.map(function (t, i) {
      return '<li><label><input type="checkbox" data-i="' + i + '"><span>' + esc(t) + '</span></label></li>';
    }).join('\n      ');
    return '<!DOCTYPE html>\n<html lang="zh-HK">\n<head>\n<meta charset="utf-8">\n'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
      + '<title>' + esc(title) + '</title>\n<style>\n'
      + ':root{color-scheme:light dark}body{font:16px/1.7 -apple-system,"Segoe UI","PingFang HK","Microsoft YaHei",sans-serif;'
      + 'max-width:720px;margin:0 auto;padding:32px 20px;background:#0f1620;color:#e8eef7}\n'
      + 'h1{font-size:20px;margin:0 0 6px}.sub{color:#8ba0b8;font-size:13px;margin-bottom:22px}\n'
      + 'ul{list-style:none;padding:0;margin:0}li{border:1px solid #26313f;border-radius:10px;margin-bottom:8px;background:#141d29}\n'
      + 'label{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;cursor:pointer}\n'
      + 'input{margin-top:4px;width:17px;height:17px;accent-color:#4da3ff}\n'
      + 'li.done span{text-decoration:line-through;color:#7d8fa5}\n'
      + '.bar{display:flex;gap:10px;margin:18px 0}.bar button{font:inherit;font-size:13px;padding:7px 13px;'
      + 'border-radius:8px;border:1px solid #2c3a4a;background:#18222e;color:#cfe0f4;cursor:pointer}\n'
      + '.note{color:#8ba0b8;font-size:12.5px;border-top:1px solid #26313f;padding-top:14px;margin-top:24px}\n'
      + '</style>\n</head>\n<body>\n<h1>' + esc(title) + '</h1>\n'
      + '<div class="sub">共 ' + items.length + ' 项 · 勾选状态保存在本机浏览器</div>\n'
      + '<ul id="list">\n      ' + li + '\n</ul>\n'
      + '<div class="bar"><button id="all">全选</button><button id="none">清空</button><button onclick="window.print()">打印</button></div>\n'
      + '<div class="note">' + esc(note || '本清单由 AlphaPath 生成，仅作材料准备提示，不构成审批承诺。') + '</div>\n'
      + '<script>\n(function(){var K=' + JSON.stringify(key) + ';var s={};try{s=JSON.parse(localStorage.getItem(K)||"{}")}catch(e){}\n'
      + 'var bs=[].slice.call(document.querySelectorAll("input[type=checkbox]"));\n'
      + 'function sync(){bs.forEach(function(b){b.closest("li").classList.toggle("done",b.checked)})}\n'
      + 'function save(){var o={};bs.forEach(function(b){o[b.dataset.i]=b.checked});localStorage.setItem(K,JSON.stringify(o))}\n'
      + 'bs.forEach(function(b){b.checked=!!s[b.dataset.i];b.addEventListener("change",function(){sync();save()})});\n'
      + 'document.getElementById("all").onclick=function(){bs.forEach(function(b){b.checked=true});sync();save()};\n'
      + 'document.getElementById("none").onclick=function(){bs.forEach(function(b){b.checked=false});sync();save()};\n'
      + 'sync();})();\n</script>\n</body>\n</html>\n';
  }

  function make_file(arg) {
    var p = parseFileArg(arg);
    var guessed = false;
    if (!p.items.length) {
      /* 模型常只给标题不给条目：按标题猜模板兜底，绝不把错误抛给用户 */
      var pr = pick_preset(p.title + ' ' + (arg || ''));
      p.items = pr.items.slice();
      if (!p.title || p.title === '续签材料清单' || p.title === '清单') p.title = pr.title;
      guessed = true;
    }
    var html = build_checklist_html(p.title, p.items, p.note);
    var path = 'artifacts/' + slugify(p.title) + '.html';
    var m = VFS.load();
    m[path] = html;
    VFS.save(m);
    return 'ARTIFACT:' + JSON.stringify({
      kind: 'checklist', title: p.title, items: p.items, path: path, note: p.note, html: html, guessed: guessed
    });
  }

  function check_coupling(arg) {    var p = parseKV(arg);
    var cid = String(p.id || p.q || '').trim();
    var items = Object.keys(KB.couplingRules).map(function (k) { return [k, KB.couplingRules[k]]; });
    if (cid && cid.toLowerCase() !== 'all' && cid !== '全部') {
      items = items.filter(function (kv) {
        return kv[0].toLowerCase() === cid.toLowerCase() || kv[1].indexOf(cid) >= 0;
      });
    }
    if (!items.length) return '未找到匹配的耦合规则：' + cid + '（有效范围 C1~C15）';
    var lines = ['【耦合规则 C1~C15】命中 ' + items.length + ' 条'];
    items.forEach(function (kv) { lines.push('- ' + kv[0] + '：' + kv[1]); });
    return lines.join('\n');
  }

  function search_schools(arg) {
    var p = parseKV(arg), q = {};
    if (p.stage) q.stage = p.stage;
    if (p.curriculum) q.curriculum = p.curriculum;
    if (p.district) q.district = p.district;
    if (p.type) q.type = p.type;
    if (p.outcome) q.outcome = p.outcome;
    if (p.maxTuition) {
      var n = parseInt(p.maxTuition, 10);
      if (!isNaN(n)) q.maxTuition = n;
    }
    var results = AP.matching.match_schools(q).slice(0, 8);
    if (!results.length) return '没有匹配的学校，请放宽筛选条件。';
    var lines = ['【择校匹配】共 ' + results.length + ' 所（出口优先；Band 为民间口径，非官方排名）'];
    results.forEach(function (s) {
      lines.push('- ' + s.name + '｜' + s.type + '｜' + s.district + '｜学费 ' + s.tuition + '｜评分 ' + s.score
        + (s.accredited ? '' : '｜非本地评审课程（毕业后无法办理 IANG）'));
    });
    return lines.join('\n');
  }

  function rag_query(arg) {
    var q = String(arg == null ? '' : arg).trim();
    if (!q) return fail('需要检索关键词');
    return AP.rag.rag_query_text(q);
  }

  function conductor_scan(conductor, arg) {
    if (!conductor) return fail('Conductor 未初始化');
    var p = parseKV(arg);
    var identity_type = p.identityType || 'TTPS_A';
    var d = new Date();
    function p2(n) { return n < 10 ? '0' + n : '' + n; }
    var activation = p.activationDate || (d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()));
    var segments = typeof p.segments === 'string' ? jsonList(p.segments) : (p.segments || []);
    var within = p.withinDays ? parseInt(p.withinDays, 10) : 90;
    if (isNaN(within) || !within) within = 90;
    var jobs = conductor.scan_due_jobs({
      identityType: identity_type, activationDate: activation, segments: segments
    }, p.as_of, within);
    if (!jobs.length) {
      return '【到期扫描】' + identity_type + '（激活 ' + activation + '）在 ' + within + ' 天窗口内无到期任务。';
    }
    var lines = ['【到期扫描】生成 ' + jobs.length + ' 个任务（窗口 ' + within + ' 天）：'];
    jobs.forEach(function (j) {
      lines.push('- ' + j.id + '｜' + j.job_type + '｜' + j.status + '｜' + ((j.payload && j.payload.message) || ''));
    });
    return lines.join('\n');
  }

  /* ---------------- 注册表 ---------------- */
  function ToolRegistry(memory_manager, conductor) {
    this.tools = {};
    this.conductor = conductor || null;
    this.memory = memory_manager || null;
    this._register(memory_manager);
  }
  ToolRegistry.prototype._register = function (mm) {
    var self = this;
    this.register('calculator', '计算数学表达式，如 12*(3+4)', calculator);
    this.register('get_time', '获取当前日期与时间（无参数）', get_time);
    this.register('legal_profile',
      '查询身份的三层法定资格剖面。参数：identityType=ESLS/TTPS_A/DEPENDANT/STUDENT 等，可选 segments=[{"kind":"gap",...}]',
      legal_profile);
    this.register('compute_timeline',
      '生成 7 年主航道续签时间线。参数：identityType=TTPS_A 与 activationDate=YYYY-MM-DD', compute_timeline);
    this.register('compute_dwell',
      '计算居住年限（② 层扣除/重算）。参数：segments（JSON 数组），可选 as_of=YYYY-MM-DD', compute_dwell);
    this.register('check_compliance',
      '合规红线自检。参数如 applicantInHk=true employer.registeredMonths=3 mpfMonths=2', check_compliance);
    this.register('check_coupling', '查询耦合规则 C1~C15。参数：空（全部）或 id=C4 / q=关键词', check_coupling);
    this.register('make_file',
      '把清单/表格做成可下载的交互式 HTML 文件（勾选状态存本机）。参数：title=标题 items=项1|项2|项3，可选 kind=checklist',
      make_file);
    this.register('search_schools',
      '按条件匹配香港学校。参数：stage=SECOND curriculum=EDU-DSE district=湾仔 maxTuition=100000', search_schools);
    this.register('rag_query', '检索本地知识库（政策/规则/学校/FAQ），参数为关键词', rag_query);
    this.register('read_file', '读取沙箱内文件（参数为文件路径）', read_file);
    this.register('write_file', '写入沙箱内文件（参数：路径|||内容）', write_file);
    this.register('list_dir', '列出沙箱内目录（参数为目录路径）', list_dir);
    this.register('run_command', '执行白名单内 shell 命令（受权限中心限制，无元字符）', run_command);
    this.register('conductor_scan',
      '扫描主航道到期里程碑并生成 Agent Job。参数：identityType=TTPS_A activationDate=YYYY-MM-DD',
      function (a) { return conductor_scan(self.conductor, a); });
    if (mm) {
      this.register('remember', '把信息写入长期记忆（参数为要记住的文本）', function (text) {
        if (!text) return fail('需要要记住的内容');
        var item = mm.remember(text, 'semantic', null, 0.7);
        return '已记住：' + text + '（记忆ID: ' + item.id + '）';
      });
      this.register('recall', '从长期记忆检索信息（参数为关键词）', function (q) {
        var items = mm.recall(q, 5);
        if (!items.length) return '没有找到相关记忆。';
        return '找到相关记忆：\n' + items.map(function (it) { return '- [' + it.type + '] ' + it.content; }).join('\n');
      });
    }
  };
  ToolRegistry.prototype.register = function (name, description, func) {
    this.tools[name] = { name: name, description: description, func: func };
  };
  ToolRegistry.prototype.call = function (name, arg) {
    var tool = this.tools[name];
    if (!tool) return fail('未知工具：' + name);
    try {
      var out = tool.func(typeof arg === 'string' ? arg : JSON.stringify(arg));
      return typeof out === 'string' ? out : JSON.stringify(out);
    } catch (e) {
      return fail('工具 ' + name + ' 执行出错：' + (e && e.message ? e.message : e));
    }
  };
  ToolRegistry.prototype.descriptions = function () {
    var self = this;
    return Object.keys(this.tools).map(function (k) {
      return { name: self.tools[k].name, description: self.tools[k].description };
    });
  };

  AP.ToolRegistry = ToolRegistry;
  AP.tools = {
    ERR_PREFIX: ERR_PREFIX, ToolRegistry: ToolRegistry, calculator: calculator, get_time: get_time,
    legal_profile: legal_profile, compute_timeline: compute_timeline, compute_dwell: compute_dwell,
    check_compliance: check_compliance, check_coupling: check_coupling, search_schools: search_schools,
    make_file: make_file, build_checklist_html: build_checklist_html,
    pick_preset: pick_preset, CHECKLIST_PRESETS: CHECKLIST_PRESETS,
    rag_query: rag_query, read_file: read_file, write_file: write_file, list_dir: list_dir,
    run_command: run_command, VFS: VFS
  };
})(typeof window !== 'undefined' ? window : globalThis);

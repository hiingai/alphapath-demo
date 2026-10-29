/* AlphaPath · Agent 主循环（移植自 v1.4 agent/harness.py）
 * LLM function calling + 规则路由兜底 + ReAct≤8 + 事件流 + 会话锁。
 * 事件：think / tool_call / tool_result / answer_delta / answer / auto_saved / done / error
 */
(function (global) {
  'use strict';
  var AP = (global.AP = (global.AP || {}));

  var SYSTEM_PROMPT = '你是 AlphaPath 智能体，专注「香港身份续签」与「香港教育择校成长」。你必须严格遵守以下纪律：\n\n'
    + '【确定性优先】涉及日期、金额、资格、合规的结论，**必须调用工具**（compute_timeline / compute_dwell /\n'
    + 'legal_profile / check_compliance / check_coupling / search_schools / rag_query），不得自行计算或猜测。\n\n'
    + '【身份定性前置】先确认身份类型，再谈永居与续签。三层法定资格表述硬约束：\n'
    + '- ① DENY（如 ESLS/SILS/FDH 等输入劳工/外佣）：必须明确「法律上不产生永居路径」，并**强制给出合规替代路径**\n'
    + '  （在港工作与生活支持、评估转换其他可累积身份）；**不得出现任何「可申请」暗示**。\n'
    + '- ② DWELL（访客期 / 签证空档 / 逾期逗留）：**只修年限、不拦服务、不隐藏入口**；只能表述「这段期间不计入」，\n'
    + '  **绝对不得**出现「不可永居」「拦截」之类语义；须声明服务入口正常开放。\n'
    + '- ③ COND（受养人 / 学生签证）：条件告警 + **必须给 ROP145 等补救路径**；受养人保证人 120 天监控。\n\n'
    + '【合规红线】\n'
    + '- C-015 逾期：**拦请求不拦身份**——拒绝任何「如何规避/处理掉逾期记录」的操作建议，只陈述法律事实。\n'
    + '- R-CALC-014 学生签：**双口径并列 + 标注「待法务确认」**；三不得：不得说一定计入、不得说一定不计入、\n'
    + '  不得给批准预期。\n'
    + '- 禁用表述：包过 / 保证通过 / 100% 成功 / 一定计入 / 一定不计入 / 确保获批。\n\n'
    + '【可溯源性】每条政策结论附出处与最后核验日期；不承诺审批结果，最终以入境事务处/教育局/劳工处官方为准。\n\n'
    + '工具使用：\n'
    + '- 生成 7 年续签时间线：compute_timeline（identityType、activationDate）。**用户给了身份+日期又问时间/永居/续签窗口时，这是唯一正确的选择，不要用其他工具。**\n'
    + '- 居住年限（② 层扣除/重算）：compute_dwell（segments JSON，可选 as_of）。\n'
    + '- 三层法定资格剖面：legal_profile（identityType、可选 segments）。\n'
    + '- 合规自检：check_compliance；耦合规则：check_coupling。\n'
    + '- 择校匹配：search_schools；政策/费用/条件：rag_query。\n'
    + '- 文件：read_file / write_file / list_dir；命令：run_command；到期扫描：conductor_scan。\n'
    + '- 做成可勾选的清单文件：make_file（title、items 用 | 分隔）。**仅当用户明确要求生成/导出清单、表格或文件时使用**；\n'
    + '  问日期、续签窗口、7 年届满请用 compute_timeline，不要用 make_file 代替。\n'
    + '- 记忆：remember / recall。\n\n'
    + '连续任务编排：任务需多步时请**连续调用**多个工具，基于上一步结果决定下一步，直到信息足够。';

  var ERR = AP.tools.ERR_PREFIX;
  var TIME_KEYWORDS = ['几点', '时间', '日期', '今天几号', '星期几', '周几', '现在是', '当前时间'];
  var ARG_FIELD_CANDIDATES = ['input', 'args', 'argument', 'path', 'query', 'command', 'text', 'value'];

  var IDENTITY_KEYWORDS = [
    [['高才通a', '高才a', 'ttps_a', 'ttps-a'], 'TTPS_A'],
    [['高才通b', '高才b', 'ttps_b'], 'TTPS_B'],
    [['高才通c', '高才c', 'ttps_c'], 'TTPS_C'],
    [['高才通', '高才', 'ttps'], 'TTPS_A'],
    [['成就计分', '成就計分', 'qmas_ach'], 'QMAS_ACH'],
    [['优才', '優才', 'qmas'], 'QMAS'],
    [['非本地毕业生', '非本地畢業生', 'iang'], 'IANG'],
    [['一般就业', '一般就業', 'gep'], 'GEP'],
    [['专才', '專才', 'asmpt', '输入内地人才', '輸入內地人才'], 'ASMTP'],
    [['非学位专才', '非學位專才'], 'NON_DEGREE'],
    [['资本投资', '資本投資', 'cies', '投资移民', '投資移民'], 'CIES'],
    [['受养人', '受養人', 'dependant', 'depend'], 'DEPENDANT'],
    [['单程证', '單程證', 'oneway'], 'ONEWAY'],
    [['外籍家庭佣工', '外籍家庭傭工', '家庭佣工', '家庭傭工', '佣工', '傭工', '外佣', '外傭', 'fdh'], 'FDH'],
    [['补充劳工', '補充勞工', 'esls', '优化计划', '優化計劃', '外劳', '外勞'], 'ESLS'],
    [['输入劳工', '輸入勞工', '行业输入', '行業輸入', 'sils', '劳工', '勞工'], 'SILS'],
    [['学生签', '學生簽', '学生签证', '學生簽證', '留学', '留學', '进修', '進修', '读书', '讀書', '读了', '讀了', '读研', '讀研', '就读', '就讀', '在读', '在讀', '研究生', '本科', '硕士', '碩士'], 'STUDENT'],
    [['访客', '訪客', '游客', '遊客', 'visitor'], 'VISITOR']
  ];

  /* 输入归一化：全角转半角 + 去掉所有空白（「高才 B 类」曾因空格被判成 A 类） */
  function norm_cn(text) {
    var s = String(text == null ? '' : text);
    s = s.replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, ' ');
    return s.replace(/\s+/g, '').toLowerCase();
  }

  var HIGH_TALENT_BEFORE = /(?:高端人才通行证|高端人才通行證|高才通|高才)(?:计划|計劃)?([abc])[类類]/;
  var HIGH_TALENT_AFTER = /([abc])[类類](?:高才通|高才)/;
  var HIGH_TALENT_LOOSE = /(?:高才通|高才)([abc])(?![\u4e00-\u9fa5])/;
  var HIGH_TALENT_ANY = /(?:高端人才通行证|高端人才通行證|高才通|高才)/;

  /* 返回 {code, ambiguous, matched}：身份没写清时不再默默当 A 类 */
  function detect_identity_detail(text) {
    var low = norm_cn(text);
    var m = low.match(HIGH_TALENT_BEFORE) || low.match(HIGH_TALENT_AFTER) || low.match(HIGH_TALENT_LOOSE);
    if (m) return { code: 'TTPS_' + m[1].toUpperCase(), ambiguous: false, matched: m[0] };
    var t = low.match(/ttps[-_]?([abc])/);
    if (t) return { code: 'TTPS_' + t[1].toUpperCase(), ambiguous: false, matched: t[0] };
    for (var i = 0; i < IDENTITY_KEYWORDS.length; i++) {
      var keys = IDENTITY_KEYWORDS[i][0];
      for (var j = 0; j < keys.length; j++) {
        if (low.indexOf(norm_cn(keys[j])) >= 0) {
          var code = IDENTITY_KEYWORDS[i][1];
          /* 「高才」「高才通」不带 A/B/C：属于歧义，不能猜 */
          if (HIGH_TALENT_ANY.test(low) && /^TTPS_[ABC]$/.test(code)) {
            return { code: null, ambiguous: true, matched: keys[j] };
          }
          return { code: code, ambiguous: false, matched: keys[j] };
        }
      }
    }
    return { code: null, ambiguous: false, matched: null };
  }

  function detect_identity(text) {
    return detect_identity_detail(text).code;
  }

  function Agent(opts) {
    opts = opts || {};
    this.memory = new AP.MemoryManager(opts);
    this.conductor = opts.conductor || new AP.Conductor();
    this.tools = new AP.ToolRegistry(this.memory, this.conductor);
    this.llm = new AP.LLMClient();
    var self = this;
    this.llm.mock.bind(function (t) { return self._route(t); }, function (n, a) { return self.tools.call(n, a); });
    this.busy = false;
    this.session_id = null;
  }

  function detect_date(text) {
    var m = String(text || '').match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (!m) return null;
    function p2(n) { n = String(parseInt(n, 10)); return n.length < 2 ? '0' + n : n; }
    return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
  }

  Agent.detect_identity = detect_identity;
  Agent._detect_date = detect_date;
  Agent.prototype.detect_identity = function (t) { return detect_identity(t); };
  Agent.prototype.detect_identity_detail = function (t) { return detect_identity_detail(t); };

  /* ---------------- 身份档案（长期记忆里的单一事实） ----------------
   * 用户说「我是高才B类」就记一条 identity-profile；之后改口成 A 类，
   * 旧记录标记 superseded 而不是删除（可追溯），并在回答里明示已更新。 */
  Agent.IDENTITY_TAG = 'identity-profile';

  function identity_label(code) {
    var it = ((AP_KB && AP_KB.identityTypes) || {})[code];
    return it ? it.name : code;
  }

  Agent.prototype.current_identity = function () {
    var best = null;
    this.memory.long_term.all_items().forEach(function (it) {
      if (it.status !== 'active') return;
      if ((it.tags || []).indexOf(Agent.IDENTITY_TAG) < 0) return;
      var m = String(it.content || '').match(/（([A-Z_]+)）/);
      if (!m) return;
      if (!best || String(it.created_at) > String(best.item.created_at)) best = { code: m[1], item: it };
    });
    return best;
  };

  Agent.prototype.remember_identity = function (code) {
    if (!code) return { changed: false, code: null, from: null };
    var cur = this.current_identity();
    if (cur && cur.code === code) return { changed: false, code: code, from: code };
    if (cur) this.memory.long_term.archive(cur.item.id, 'identity-changed');
    this.memory.long_term.add('身份类型：' + identity_label(code) + '（' + code + '）', 'semantic', null,
      ['profile', Agent.IDENTITY_TAG], 0.9, 'user');
    return { changed: true, code: code, from: cur ? cur.code : null };
  };

  /* ---------------- 规则路由（离线兜底） ---------------- */
  function checklist_preset(text) {
    if (AP.tools && AP.tools.pick_preset) return AP.tools.pick_preset(text);
    return { title: '续签材料清单', items: ['身份证明文件', '雇佣合同或聘用书'] };
  }

  /* 工具产出的「文件」结果转成人话（保留 ARTIFACT 标记给前端渲染卡片） */
  function friendly_tool_reply(result) {
    var s = String(result == null ? '' : result);
    if (s.indexOf('ARTIFACT:') !== 0) return s;
    var spec = null;
    try { spec = JSON.parse(s.slice(9)); } catch (e) { return s; }
    if (!spec) return s;
    return '已生成《' + spec.title + '》交互式清单：共 ' + (spec.items || []).length + ' 项，'
      + '在下面直接勾选即可（勾选状态保存在本机），也可以点「下载 HTML」带走一个能离线用的文件。\n'
      + '注意清单只是材料准备提示，具体要求以入境处最新公布为准。\n\n' + s;
  }

  /* 高置信度时间线路由：命中即走确定性引擎，不进 LLM 工具循环。
   * fallbackIdent 来自身份档案（用户这轮没重复身份时用），会带上「按记忆」提示。 */
  function timeline_route(t, fallbackIdent) {
    var text = String(t == null ? '' : t).trim();
    if (!text) return null;
    var identOwn = detect_identity(text);
    var ident = identOwn || fallbackIdent || null;
    var date = detect_date(text);
    if (!ident || !date) return null;
    if (/(空档|断签|断了|访客|游客|逾期|超期|不计入|算不算|算几年)/.test(text)) return null;
    if (!/(什么时候|多久|何时|时间线|主航道|7\s*年|七年|永居|永久|续签窗口|到期|届满)/.test(text)) return null;
    return {
      tool: 'compute_timeline',
      arg: 'identityType=' + ident + ' activationDate=' + date,
      fromProfile: !identOwn && !!fallbackIdent
    };
  }

  Agent.prototype._route = function (text) {
    var t = String(text == null ? '' : text).trim();
    var ident = detect_identity(t);
    /* 用户这轮没说身份 → 用记忆里的身份档案（只说「我的签证什么时候到期」也能算对类别） */
    if (!ident) {
      var prof = this.current_identity();
      if (prof) ident = prof.code;
    }
    var date = detect_date(t);
    var m;

    m = t.match(/(?:计算|算一下)\s*[：:]?\s*(.+)/);
    if (m) return { tool: 'calculator', arg: m[1].trim() };
    if (/^[\d\s+\-*/().%^]+$/.test(t) && /[+\-*/]/.test(t)) return { tool: 'calculator', arg: t };

    if (TIME_KEYWORDS.some(function (k) { return t.indexOf(k) >= 0; })) return { tool: 'get_time', arg: '' };

    /* 要做清单/表格/文件 → 生成可勾选的 HTML（MVP 不限制这类正常需求） */
    if (/(清单|表格|文件|checklist|导出|勾选|html)/i.test(t)
        && /(做成|生成|导出|制作|整理|列成|列个|来个|帮我做|写个|写一个|做一个)/.test(t)) {
      var preset = checklist_preset(t);
      return { tool: 'make_file', arg: 'title=' + preset.title + '\nitems=' + preset.items.join('|') };
    }

    m = t.match(/(?:记住|记一下)\s*[：:]?\s*(.+)/);
    if (m) return { tool: 'remember', arg: m[1].trim() };
    if (/(我(之前)?(说|提)过什么|我喜欢什么|回忆|还记得)/.test(t)) return { tool: 'recall', arg: t };

    if (/(到期扫描|扫描(到期)?任务|待办扫描|conductor)/.test(t)) {
      if (!ident) return null;
      var arg = 'identityType=' + ident;
      if (date) arg += ' activationDate=' + date;
      return { tool: 'conductor_scan', arg: arg };
    }

    if (/(合规|红线|假雇佣|身在香港|访客.*入读|风险)/.test(t)) {
      var carg = '';
      if (/(不在|没有在|不在港|离港)/.test(t)) carg = 'applicantInHk=false';
      else if (/(在港|身在香港|人在香港)/.test(t)) carg = 'applicantInHk=true';
      if (/(雇主|公司).{0,8}(成立|注册)/.test(t)) carg += ' employer.registeredMonths=3';
      if (carg) return { tool: 'check_compliance', arg: carg.trim() };
    }

    /* 有身份 + 有日期 + 问「什么时候」→ 直接算时间线（比只给剖面有用） */
    if (ident && date && !/(空档|断签|断了|访客|游客|逾期|超期|不计入|算不算|算几年)/.test(t)
        && /(什么时候|多久|何时|时间线|主航道|7\s*年|七年|永居|永久|续签窗口|到期)/.test(t)) {
      return { tool: 'compute_timeline', arg: 'identityType=' + ident + ' activationDate=' + date };
    }

    if ((ident || detect_identity_detail(t).ambiguous)
        && /(永居|永久|通常居住|能拿|能不能|可不可以|算不算|什么身份|资格|续签|怎么办)/.test(t)) {
      /* 「高才」没写 A/B/C 时，资格层面（tier / 可否永居）三类相同，仅年期不同，
       * 按 A 类口径给剖面并在文案里标注；涉及具体日期则先问类别，绝不猜。 */
      var profIdent = ident || 'TTPS_A';
      var seg = '';
      if (/(空档|断签|断了)/.test(t)) seg = ' segments=[{"kind":"gap","start":"2025-01-01","end":"2025-03-01"}]';
      if (/(访客|游客)/.test(t)) seg = ' segments=[{"kind":"visitor","start":"2024-01-01","end":"2024-04-01"}]';
      if (/(逾期|超期)/.test(t)) seg = ' segments=[{"kind":"overstay","start":"2024-05-01","end":"2024-06-01"}]';
      return { tool: 'legal_profile', arg: 'identityType=' + profIdent + seg };
    }

    if (/(空档|断签|访客|游客|逾期|超期|居住年限|住了多久|算几年|不计入)/.test(t)) {
      var segs;
      if (/(空档|断签|断了)/.test(t)) {
        segs = [{ kind: 'visa', start: '2023-09-01', end: '2025-01-01' },
          { kind: 'gap', start: '2025-01-01', end: '2025-03-01' },
          { kind: 'visa', start: '2025-03-01', end: '2026-10-01' }];
      } else if (/(访客|游客)/.test(t)) {
        segs = [{ kind: 'visa', start: '2023-09-01', end: '2024-01-01' },
          { kind: 'visitor', start: '2024-01-01', end: '2024-04-01' },
          { kind: 'visa', start: '2024-04-01', end: '2026-10-01' }];
      } else {
        segs = [{ kind: 'visa', start: '2023-09-01', end: '2024-05-01' },
          { kind: 'overstay', start: '2024-05-01', end: '2024-06-01' },
          { kind: 'visa', start: '2024-06-01', end: '2026-10-01' }];
      }
      return { tool: 'compute_dwell', arg: JSON.stringify({ segments: segs }) };
    }

    if (/(时间线|主航道|续签窗口|续签|7\s*年|七年|永居|什么时候|还有多久|到期)/.test(t)) {
      if (ident && date) return { tool: 'compute_timeline', arg: 'identityType=' + ident + ' activationDate=' + date };
      if (date && ident) return { tool: 'compute_timeline', arg: 'identityType=' + ident + ' activationDate=' + date };
    }

    if (/(耦合|C1|C4|C5|C10|C15|相互影响)/.test(t)) {
      var mc = t.match(/\bC(\d{1,2})\b/);
      return { tool: 'check_coupling', arg: mc ? ('id=C' + mc[1]) : '' };
    }

    if (/(择校|学校|小学|中学|插班|中一|小一|国际课程|IB|DSE|升学|报名)/.test(t)) {
      var params = [];
      if (t.indexOf('中一') >= 0 || t.indexOf('中学') >= 0) params.push('stage=SECOND');
      if (t.indexOf('小一') >= 0 || t.indexOf('小学') >= 0) params.push('stage=PRIMARY');
      if (/(国际|ib)/i.test(t)) params.push('curriculum=EDU-IB');
      else if (/dse/i.test(t)) params.push('curriculum=EDU-DSE');
      return { tool: 'search_schools', arg: params.join(' ') };
    }

    if (/(政策|费用|多少钱|收费|需要什么|什么条件|多久|更新)/.test(t)) return { tool: 'rag_query', arg: t };

    m = t.match(/(?:读取|打开|查看|读一下|看看)\s*(?:文件)?\s*[：:]?\s*([^\s]+\.\w+)/);
    if (m) return { tool: 'read_file', arg: m[1] };
    m = t.match(/(?:写入|保存到|写到)\s*[：:]?\s*([^\s]+\.\w+)\s*[，,：:]?\s*(.*)/);
    if (m) return { tool: 'write_file', arg: m[1] + '|||' + m[2].trim() };
    m = t.match(/(?:列出|查看)\s*(?:目录|文件夹)\s*[：:]?\s*(\S*)/);
    if (m) return { tool: 'list_dir', arg: (m[1] || '.').trim() || '.' };

    m = t.match(/(?:运行命令|执行命令|运行程序|跑一下|执行|运行)\s*[：:]?\s*(.+)/);
    if (m) {
      var cargv = m[1].trim().replace(/^(?:命令|程序|指令)\s*[：:]?\s*/, '').trim();
      if (cargv) return { tool: 'run_command', arg: cargv };
    }
    return null;
  };

  /* ---------------- 工具 schema ---------------- */
  Agent.prototype._arg_desc = function (name) {
    var m = {
      read_file: '沙箱内文件路径', list_dir: '沙箱内目录路径', run_command: '白名单内纯命令',
      write_file: '路径|||内容', rag_query: '检索关键词',
      search_schools: '如 stage=SECOND curriculum=EDU-DSE',
      compute_timeline: '如 identityType=TTPS_A activationDate=2023-09-01',
      compute_dwell: '如 {"segments":[{"kind":"gap","start":"2025-01-01","end":"2025-03-01"}]}',
      legal_profile: '如 identityType=DEPENDANT',
      check_compliance: '如 applicantInHk=true',
      check_coupling: '如 id=C4', remember: '要记住的文本', recall: '检索关键词',
      conductor_scan: '如 identityType=TTPS_A activationDate=2023-09-01',
      calculator: '数学表达式'
    };
    return m[name] || '工具参数（字符串）';
  };
  Agent.prototype._tool_schemas = function () {
    var self = this;
    return Object.keys(this.tools.tools).map(function (name) {
      var t = self.tools.tools[name];
      var props = (name === 'get_time') ? {} : {
        input: { type: 'string', description: self._arg_desc(name) }
      };
      return {
        type: 'function', function: {
          name: name, description: t.description,
          parameters: { type: 'object', properties: props, required: Object.keys(props) }
        }
      };
    });
  };
  Agent.prototype._extract_arg = function (name, raw) {
    var parsed;
    if (raw && typeof raw === 'object') parsed = raw;
    else {
      try { parsed = raw ? JSON.parse(raw) : {}; } catch (e) { return String(raw || '').trim(); }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return String(parsed).trim();
    var mapping = {
      compute_timeline: 'identityType', legal_profile: 'identityType', conductor_scan: 'identityType',
      check_coupling: 'id', read_file: 'path', list_dir: 'path', write_file: 'path'
    };
    var key = mapping[name];
    if (key && parsed[key] !== undefined) {
      var extra = '';
      if ((name === 'compute_timeline' || name === 'conductor_scan') && parsed.activationDate !== undefined) {
        extra = ' activationDate=' + parsed.activationDate;
      }
      if (name === 'legal_profile' && parsed.segments !== undefined) {
        extra = ' segments=' + JSON.stringify(parsed.segments);
      }
      return key + '=' + parsed[key] + extra;
    }
    for (var i = 0; i < ARG_FIELD_CANDIDATES.length; i++) {
      var k = ARG_FIELD_CANDIDATES[i];
      if (parsed[k] !== undefined) {
        var v = parsed[k];
        return typeof v === 'string' ? v : JSON.stringify(v);
      }
    }
    var keys = Object.keys(parsed);
    for (var j = 0; j < keys.length; j++) {
      if (typeof parsed[keys[j]] === 'string') return parsed[keys[j]].trim();
    }
    return '';
  };

  function emit(on_event, event) {
    if (!on_event) return;
    try { on_event(event); } catch (e) { /* ignore */ }
  }
  Agent._emit = emit;

  /* ---------------- LLM 工具循环 ---------------- */
  Agent.prototype._chat_with_tools = async function (user_input, memory_context, on_event, streamed) {
    if (!this.llm.hasApi()) return null;
    var system = SYSTEM_PROMPT + (memory_context ? ('\n\n' + memory_context) : '');
    var messages = this.memory.short_term.get();
    var tools = this._tool_schemas();
    var used_tools = [], last_results = [], steps = [], round_idx, lastFailSig = '';
    var self = this;

    for (round_idx = 0; round_idx < AP.CFG.MAX_TOOL_ROUNDS; round_idx++) {
      emit(on_event, { type: 'think', round: round_idx + 1, text: '第 ' + (round_idx + 1) + ' 轮：正在推理下一步…' });
      var on_delta = function (piece) {
        streamed[0] = true;
        emit(on_event, { type: 'answer_delta', text: piece });
      };
      var resp;
      try {
        resp = await this.llm.chatStreamWithTools(messages, system, tools, on_delta);
      } catch (e) {
        if (e && e.message === 'NOT_IMPLEMENTED') return null;
        throw e;
      }
      if (resp === null) {
        if (last_results.length) {
          return {
            reply: last_results.map(function (r) { return r.result; }).join('\n\n') || '（工具未返回内容）',
            tool_used: used_tools.length ? used_tools[used_tools.length - 1] : null, steps: steps
          };
        }
        return null;
      }
      var tool_calls = resp.tool_calls || [];
      var content = resp.content;
      if (!tool_calls.length) {
        if (content) return { reply: content, tool_used: used_tools.length ? used_tools[used_tools.length - 1] : null, steps: steps };
        if (last_results.length) {
          return {
            reply: last_results.map(function (r) { return r.result; }).join('\n\n'),
            tool_used: used_tools.length ? used_tools[used_tools.length - 1] : null, steps: steps
          };
        }
        return null;
      }
      var round_results = [];
      tool_calls.forEach(function (call) {
        var fn = call.function || {};
        var name = fn.name || '';
        if (!name) return;
        var arg = self._extract_arg(name, fn.arguments);
        emit(on_event, { type: 'tool_call', name: name, arg: arg });
        var result = self.tools.call(name, arg);
        var ok = String(result).indexOf(ERR) !== 0;
        used_tools.push(name);
        emit(on_event, { type: 'tool_result', name: name, arg: arg, result: result, ok: ok });
        steps.push({ name: name, arg: arg, result: result, ok: ok });
        round_results.push({ name: name, arg: arg, result: result, tool_call_id: call.id || '' });
      });
      if (!round_results.length) return null;
      /* 同一工具同一参数连续失败：别再空转 8 轮，直接交回上层处理 */
      var allErr = round_results.every(function (r) { return String(r.result).indexOf(ERR) === 0; });
      var sig = round_results.map(function (r) { return r.name + '|' + r.arg; }).join(';');
      if (allErr) {
        if (sig === lastFailSig) return null;
        lastFailSig = sig;
      }
      last_results = round_results;
      this._record_tool_round(tool_calls, round_results);
      messages = this.memory.short_term.get();
    }
    if (!last_results.length) return null;
    var tail = last_results.map(function (r) { return r.result; }).join('\n\n');
    if (String(tail).indexOf(ERR) === 0) return null;  /* 全失败：交回上层，别把错误当答案 */
    return {
      reply: tail || '（工具调用轮数过多，已停止）',
      tool_used: used_tools.length ? used_tools[used_tools.length - 1] : null, steps: steps
    };
  };

  Agent.prototype._record_tool_round = function (tool_calls, results) {
    try {
      this.memory.short_term.add_message({ role: 'assistant', content: null, tool_calls: tool_calls });
      results.forEach(function (r) {
        this.memory.short_term.add_message({
          role: 'tool', tool_call_id: r.tool_call_id, name: r.name, content: r.result
        });
      }, this);
    } catch (e) { /* ignore */ }
  };

  Agent.prototype._tier_for = function (route, applicant) {
    var m;
    if (applicant && applicant.identityType) return AP.legal.legal_profile_of(applicant).tier;
    if (route && route.tool === 'compute_dwell') return 'dwell';
    if (route && (route.tool === 'legal_profile' || route.tool === 'compute_timeline' || route.tool === 'conductor_scan')) {
      m = String(route.arg || '').match(/identityType=(\w+)/);
      if (m) return AP.legal.legal_profile_of({ identityType: m[1], segments: [] }).tier;
    }
    return null;
  };

  /* ---------------- 主循环 ---------------- */
  Agent.prototype.chat = async function (user_input, on_event, applicant) {
    if (this.busy) {
      emit(on_event, { type: 'error', message: '该会话正在处理上一条消息，请稍候。' });
      throw new Error('BUSY');
    }
    this.busy = true;
    var self = this;
    try {
      user_input = user_input || '';
      this.memory.short_term.add('user', user_input);
      if (applicant) this.memory.working.set('applicant', applicant);
      var memory_context = this.memory.build_context(user_input, AP.CFG.RETRIEVE_TOP_K);
      var recalled = this.memory.recall(user_input, AP.CFG.RETRIEVE_TOP_K);
      var G = AP.guardrails;
      var tool_used = null, reply = null, steps = [], streamed = [false];

      /* 日期合法性前置检查：用户写了不存在的日期（2023-09-31、2025-02-30…）时，
       * 不进入任何计算，直接把「哪一天不存在 + 两个候选」说清楚，让用户确认。 */
      var dateCheck = null;
      var rawDate = detect_date(user_input);
      if (rawDate && AP.timeline && AP.timeline.check_date) dateCheck = AP.timeline.check_date(rawDate);
      if (dateCheck && !dateCheck.ok) {
        emit(on_event, { type: 'think', round: 1, text: '日期「' + dateCheck.input + '」不合法，先向用户确认，不做计算。' });
        var dReply = dateCheck.message
          + (dateCheck.suggestions && dateCheck.suggestions.length
            ? '\n确认是哪一个？回复日期我立刻算 7 年主航道。'
            : '\n请补一个真实日期，我再算 7 年主航道。')
          + '\n我不会替你猜日期——猜错一天，续签窗口就全错。';
        emit(on_event, { type: 'answer', text: dReply });
        this.memory.short_term.add('assistant', dReply);
        emit(on_event, { type: 'done' });
        return {
          reply: dReply, tool_used: null, steps: [], tier: this._tier_for(null, applicant),
          escalation: null, memories: recalled.map(function (m) { return m.to_dict(); }),
          auto_saved: null, blocked: null
        };
      }

      /* 身份口径前置检查：
       * ① 身份写清（高才B类 / 高端人才通行证计划 B 类…）→ 写入长期记忆的 identity-profile，
       *    改了类别的旧记录标记 superseded，并在回答里明示「已更新」。
       * ② 只写「高才」不带 A/B/C → 不猜、不默认 A 类，直接问清是哪一类（首签年期不同）。 */
      var identityNote = '';
      var idDetail = detect_identity_detail(user_input);
      var timelineIntent = /(什么时候|多久|何时|时间线|主航道|7\s*年|七年|永居|永久|续签窗口|到期|届满)/.test(user_input);
      if (idDetail.code && !idDetail.ambiguous) {
        var idUpd = this.remember_identity(idDetail.code);
        if (idUpd.changed && idUpd.from) {
          identityNote = '（已更新你的身份记录：' + identity_label(idUpd.from) + ' → ' + identity_label(idUpd.code)
            + '，后续按新类别计算）\n';
          emit(on_event, { type: 'think', round: 1, text: '身份档案更新：' + idUpd.from + ' → ' + idUpd.code + '。' });
        }
      } else if (idDetail.ambiguous && (rawDate || /(到期|续签窗口|主航道|时间线|首签|届满)/.test(user_input))) {
        var aReply = '你说的「高才」我这边分 A / B / C 三类，**首签年期不一样，算出来的到期日会差一年**：\n'
          + '- A 类：前一年收入 ≥ 250 万港元 → 首签 3 年（3+3+3）\n'
          + '- B 类：合资格大学学士 + 前 5 年累计 ≥ 3 年经验 → 首签 2 年（2+3+3）\n'
          + '- C 类：合资格大学学士、经验 < 3 年（有配额）→ 首签 2 年（2+3+3）\n'
          + '你是哪一类？告诉我我就按对应年期算，不会替你按 A 类猜。';
        emit(on_event, { type: 'think', round: 1, text: '只提到「高才」未指明 A/B/C，先确认类别，不做计算。' });
        emit(on_event, { type: 'answer', text: aReply });
        this.memory.short_term.add('assistant', aReply);
        emit(on_event, { type: 'done' });
        return {
          reply: aReply, tool_used: null, steps: [], tier: this._tier_for(null, applicant),
          escalation: null, memories: recalled.map(function (m) { return m.to_dict(); }),
          auto_saved: null, blocked: null
        };
      }

      if (G.is_evasion_request(user_input)) {
        emit(on_event, { type: 'think', round: 1, text: '命中 C-015：拒绝规避请求，仅陈述法律事实。' });
        reply = G.C015_REASON;
        for (var i = 0; i < reply.length; i += 16) emit(on_event, { type: 'answer_delta', text: reply.slice(i, i + 16) });
        emit(on_event, { type: 'answer', text: reply });
        this.memory.short_term.add('assistant', reply);
        emit(on_event, { type: 'done' });
        return {
          reply: reply, tool_used: null, steps: [], tier: this._tier_for(null, applicant),
          escalation: null, memories: recalled.map(function (m) { return m.to_dict(); }),
          auto_saved: null, blocked: 'C-015'
        };
      }

      /* 旗舰功能保护：身份 + 日期 + 时间线问题，直接由确定性引擎回答，
       * 不交给大模型「自由发挥」——避免模型乱选工具把主航道问成文件生成。 */
      var profIdent = this.current_identity();
      var strong = timeline_route(user_input, profIdent ? profIdent.code : null);
      if (strong && strong.fromProfile) {
        identityNote += '（按你之前的记录：' + identity_label(profIdent.code) + '；不对就说「我是X类」我改过来）\n';
      }
      var llm_result = strong ? null : await this._chat_with_tools(user_input, memory_context, on_event, streamed);
      if (llm_result !== null) {
        reply = llm_result.reply;
        tool_used = llm_result.tool_used;
        steps = llm_result.steps || [];
        /* 模型把工具调崩了就别把 __ERROR__ 抛给用户：退回确定性路由 */
        if (String(reply).indexOf(ERR) === 0) {
          var rescue = timeline_route(user_input, (this.current_identity() || {}).code || null) || this._route(user_input);
          if (rescue) {
            emit(on_event, { type: 'think', round: 1, text: '工具调用出错，已回退到确定性引擎重算。' });
            emit(on_event, { type: 'tool_call', name: rescue.tool, arg: rescue.arg });
            reply = this.tools.call(rescue.tool, rescue.arg);
            var rok = String(reply).indexOf(ERR) !== 0;
            emit(on_event, { type: 'tool_result', name: rescue.tool, arg: rescue.arg, result: reply, ok: rok });
            steps.push({ name: rescue.tool, arg: rescue.arg, result: reply, ok: rok });
            tool_used = rescue.tool;
            reply = friendly_tool_reply(reply);
            streamed[0] = false;
          } else {
            reply = '刚才的工具调用出错了，我没能给出可靠结论。可以换个说法再问一次（例如附上身份类型和激活日期），我不会凭猜测给日期。';
            streamed[0] = false;
          }
        }
      } else {
        var route = strong || this._route(user_input);
        if (route) {
          tool_used = route.tool;
          emit(on_event, { type: 'think', round: 1, text: '规则路由命中：' + route.tool + '，准备调用确定性引擎。' });
          emit(on_event, { type: 'tool_call', name: route.tool, arg: route.arg });
          reply = this.tools.call(route.tool, route.arg);
          var ok = String(reply).indexOf(ERR) !== 0;
          emit(on_event, { type: 'tool_result', name: route.tool, arg: route.arg, result: reply, ok: ok });
          steps.push({ name: route.tool, arg: route.arg, result: reply, ok: ok });
          reply = friendly_tool_reply(reply);
        } else {
          emit(on_event, { type: 'think', round: 1, text: '未命中工具路由，直接生成回答。' });
          var system = SYSTEM_PROMPT + (memory_context ? ('\n\n' + memory_context) : '');
          var chunks = [];
          var full = this.memory.short_term.get();
          await this.llm.chatStream(full, system, function (piece) {
            chunks.push(piece);
            streamed[0] = true;
            emit(on_event, { type: 'answer_delta', text: piece });
          });
          reply = chunks.join('');
        }
      }

      if (!reply) reply = '（没有生成回复，请重试或换一种说法。）';
      if (identityNote && String(reply).indexOf(identityNote.trim()) < 0) reply = identityNote + reply;

      var last_arg = steps.length ? steps[steps.length - 1].arg : '';
      var tier = this._tier_for({ tool: tool_used, arg: last_arg }, applicant);
      var guard = G.guard_output(reply, tier);
      if (guard.blocked) {
        emit(on_event, { type: 'think', round: 1, text: '输出守门命中，已改写回答。' });
        reply = guard.reason;
        streamed[0] = false;
      } else if (guard.text && guard.text !== reply) {
        reply = guard.text;
        streamed[0] = false;
      }
      var escalation = guard.escalation || null;

      if (!streamed[0]) {
        for (var j = 0; j < reply.length; j += 16) emit(on_event, { type: 'answer_delta', text: reply.slice(j, j + 16) });
      }
      emit(on_event, { type: 'answer', text: reply });
      this.memory.short_term.add('assistant', reply);

      var saved = this.memory.maybe_auto_save();
      if (saved) emit(on_event, { type: 'auto_saved', item: saved.to_dict() });
      emit(on_event, { type: 'done' });

      return {
        reply: reply, tool_used: tool_used, steps: steps, tier: tier, escalation: escalation,
        memories: recalled.map(function (m) { return m.to_dict(); }),
        auto_saved: saved ? saved.to_dict() : null
      };
    } finally {
      this.busy = false;
    }
  };

  /* ---------------- 反思 / 状态 ---------------- */
  function extract_text(msg) {
    var content = msg.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content.map(function (p) { return (p && typeof p === 'object') ? (p.text || '') : String(p); }).join(' ').trim();
    }
    return '';
  }
  Agent._extract_text = extract_text;

  Agent.prototype.reflect = function () {
    var msgs = this.memory.short_term.get();
    var all = [], users = [];
    msgs.forEach(function (m) {
      var text = extract_text(m);
      if (!text) return;
      all.push(text);
      if (m.role === 'user') users.push(text);
    });
    var picked = users.length ? users : all;
    if (!picked.length) return { reply: '无有效内容。', memory: null };
    var summary = picked.slice(-3).join('；');
    var item = this.memory.long_term.add('本次对话涉及：' + summary, 'episodic', summary.slice(0, 50), ['对话记录'], 0.4);
    this.memory.short_term.clear();
    return { reply: '已沉淀情景记忆：本次对话涉及：' + summary, memory: item ? item.to_dict() : null };
  };

  Agent.prototype.stats = function () {
    return {
      memory: this.memory.stats(),
      short_term_turns: this.memory.short_term.turns(),
      llm_mode: this.llm.hasApi() ? 'API' : '离线 MockLLM + 规则路由',
      auto_save: AP.CFG.AUTO_SAVE,
      dedup_enabled: AP.CFG.DEDUP_ENABLED,
      vector_enabled: AP.CFG.VECTOR_ENABLED,
      rag_coverage: AP.rag.coverage(),
      tools: Object.keys(this.tools.tools).length
    };
  };
  Agent.prototype.list_memories = function (limit) {
    var items = this.memory.long_term.all_items();
    items.sort(function (a, b) { return Date.parse(b.created_at) - Date.parse(a.created_at); });
    return items.slice(0, limit || 50).map(function (i) { return i.to_dict(); });
  };
  Agent.prototype.list_tools = function () { return this.tools.descriptions(); };
  Agent.prototype.clear_short_term = function () { this.memory.short_term.clear(); };

  AP.Agent = Agent;
  AP.SYSTEM_PROMPT = SYSTEM_PROMPT;
})(typeof window !== 'undefined' ? window : globalThis);

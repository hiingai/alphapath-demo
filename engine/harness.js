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
    + '- 生成 7 年续签时间线：compute_timeline（identityType、activationDate）。\n'
    + '- 居住年限（② 层扣除/重算）：compute_dwell（segments JSON，可选 as_of）。\n'
    + '- 三层法定资格剖面：legal_profile（identityType、可选 segments）。\n'
    + '- 合规自检：check_compliance；耦合规则：check_coupling。\n'
    + '- 择校匹配：search_schools；政策/费用/条件：rag_query。\n'
    + '- 文件：read_file / write_file / list_dir；命令：run_command；到期扫描：conductor_scan。\n'
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
    [['成就计分', 'qmas_ach'], 'QMAS_ACH'],
    [['优才', 'qmas'], 'QMAS'],
    [['非本地毕业生', 'iang'], 'IANG'],
    [['一般就业', 'gep'], 'GEP'],
    [['专才', 'asmpt', '输入内地人才'], 'ASMTP'],
    [['非学位专才'], 'NON_DEGREE'],
    [['资本投资', 'cies', '投资移民'], 'CIES'],
    [['受养人', 'dependant', 'depend'], 'DEPENDANT'],
    [['单程证', 'oneway'], 'ONEWAY'],
    [['外籍家庭佣工', '家庭佣工', '佣工', '外佣', 'fdh'], 'FDH'],
    [['补充劳工', 'esls', '优化计划', '外劳'], 'ESLS'],
    [['输入劳工', '行业输入', 'sils', '劳工'], 'SILS'],
    [['学生签', '学生签证', '留学', '进修', '读书', '读了', '读研', '就读', '在读', '研究生', '本科', '硕士'], 'STUDENT'],
    [['访客', '游客', 'visitor'], 'VISITOR']
  ];

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

  function detect_identity(text) {
    var low = String(text || '').toLowerCase();
    for (var i = 0; i < IDENTITY_KEYWORDS.length; i++) {
      var keys = IDENTITY_KEYWORDS[i][0];
      for (var j = 0; j < keys.length; j++) {
        if (low.indexOf(keys[j]) >= 0) return IDENTITY_KEYWORDS[i][1];
      }
    }
    return null;
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

  /* ---------------- 规则路由（离线兜底） ---------------- */
  Agent.prototype._route = function (text) {
    var t = String(text == null ? '' : text).trim();
    var ident = detect_identity(t);
    var date = detect_date(t);
    var m;

    m = t.match(/(?:计算|算一下)\s*[：:]?\s*(.+)/);
    if (m) return { tool: 'calculator', arg: m[1].trim() };
    if (/^[\d\s+\-*/().%^]+$/.test(t) && /[+\-*/]/.test(t)) return { tool: 'calculator', arg: t };

    if (TIME_KEYWORDS.some(function (k) { return t.indexOf(k) >= 0; })) return { tool: 'get_time', arg: '' };

    m = t.match(/(?:记住|记一下)\s*[：:]?\s*(.+)/);
    if (m) return { tool: 'remember', arg: m[1].trim() };
    if (/(我(之前)?(说|提)过什么|我喜欢什么|回忆|还记得)/.test(t)) return { tool: 'recall', arg: t };

    if (/(到期扫描|扫描(到期)?任务|待办扫描|conductor)/.test(t)) {
      var arg = 'identityType=' + (ident || 'TTPS_A');
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

    if (ident && /(永居|永久|通常居住|能拿|能不能|可不可以|算不算|什么身份|资格|续签|怎么办)/.test(t)) {
      var seg = '';
      if (/(空档|断签|断了)/.test(t)) seg = ' segments=[{"kind":"gap","start":"2025-01-01","end":"2025-03-01"}]';
      if (/(访客|游客)/.test(t)) seg = ' segments=[{"kind":"visitor","start":"2024-01-01","end":"2024-04-01"}]';
      if (/(逾期|超期)/.test(t)) seg = ' segments=[{"kind":"overstay","start":"2024-05-01","end":"2024-06-01"}]';
      return { tool: 'legal_profile', arg: 'identityType=' + ident + seg };
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
      if (date) return { tool: 'compute_timeline', arg: 'identityType=' + (ident || 'TTPS_A') + ' activationDate=' + date };
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
    var used_tools = [], last_results = [], steps = [], round_idx;
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
      last_results = round_results;
      this._record_tool_round(tool_calls, round_results);
      messages = this.memory.short_term.get();
    }
    return {
      reply: last_results.map(function (r) { return r.result; }).join('\n\n') || '（工具调用轮数过多，已停止）',
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

      var llm_result = await this._chat_with_tools(user_input, memory_context, on_event, streamed);
      if (llm_result !== null) {
        reply = llm_result.reply;
        tool_used = llm_result.tool_used;
        steps = llm_result.steps || [];
      } else {
        var route = this._route(user_input);
        if (route) {
          tool_used = route.tool;
          emit(on_event, { type: 'think', round: 1, text: '规则路由命中：' + route.tool + '，准备调用确定性引擎。' });
          emit(on_event, { type: 'tool_call', name: route.tool, arg: route.arg });
          reply = this.tools.call(route.tool, route.arg);
          var ok = String(reply).indexOf(ERR) !== 0;
          emit(on_event, { type: 'tool_result', name: route.tool, arg: route.arg, result: reply, ok: ok });
          steps.push({ name: route.tool, arg: route.arg, result: reply, ok: ok });
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

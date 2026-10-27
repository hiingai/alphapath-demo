/* AlphaPath · 编排内核（移植自 v1.4 agent/conductor.py）
 * Agent Job 状态机 + 人工关卡（HLG）+ T-90/T-30/② 层/③ 层时间触发扫描。内存态 + localStorage。
 */
(function (global) {
  'use strict';
  var AP = (global.AP = global.AP || {});

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function localISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
      + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function asDate(s) {
    var t = AP.timeline.p(String(s).slice(0, 10));
    return t;
  }
  function todayDate() {
    var d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  function uid10() {
    var s = '';
    for (var i = 0; i < 10; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
    return s;
  }

  function AgentJob(job_type, payload) {
    this.id = 'JOB-' + uid10();
    this.job_type = job_type;
    this.status = 'QUEUED';
    this.payload = payload ? JSON.parse(JSON.stringify(payload)) : {};
    this.output = null;
    this.attempt = 0;
    this.max_attempt = 3;
    this.hl_gate = null;
    this.created_at = localISO();
    this.traces = [];
  }
  AgentJob.prototype.to_dict = function () {
    return {
      id: this.id, jobType: this.job_type, status: this.status, payload: this.payload,
      output: this.output, attempt: this.attempt, maxAttempt: this.max_attempt,
      hlGate: this.hl_gate, createdAt: this.created_at, traces: this.traces
    };
  };

  function Conductor() { this.jobs = {}; }
  Conductor.prototype.create_job = function (job_type, payload) {
    var job = new AgentJob(job_type, payload);
    this.jobs[job.id] = job;
    this._trace(job, 'PLAN', { jobType: job_type });
    return job;
  };
  Conductor.prototype.submit_case = function (payload) {
    return this.run(this.create_job('CASE_ONBOARD', payload));
  };
  Conductor.prototype.run = function (job) {
    job.status = 'RUNNING';
    job.attempt += 1;
    this._trace(job, 'EXECUTE', { attempt: job.attempt });
    try {
      var handler = this['_do_' + String(job.job_type).toLowerCase()];
      if (typeof handler !== 'function') {
        job.status = 'FAILED';
        job.output = { error: '未知任务类型：' + job.job_type };
      } else {
        handler.call(this, job);
      }
    } catch (e) {
      if (job.attempt >= job.max_attempt) {
        job.status = 'FAILED';
        job.output = { error: String(e && e.message || e) };
      } else {
        job.status = 'QUEUED';
      }
      this._trace(job, 'ERROR', { error: String(e && e.message || e) });
    }
    this._trace(job, 'COMMIT', { status: job.status });
    return job;
  };
  Conductor.prototype._do_case_onboard = function (job) {
    var p = job.payload;
    var profile = AP.legal.legal_profile_of({ identityType: p.identityType, segments: p.segments || [] });
    var out = { legalTier: profile.tier, canPr: profile.canPr, notices: profile.notices };
    if (p.identityType && p.activationDate) {
      try {
        var t = AP.timeline.compute_visa_timeline(p.identityType, p.activationDate);
        out.timeline = { expiry: t.expiry, applyWindow: t.applyWindow, prDate: t.prDate, canPr: t.canPr };
      } catch (e) {
        out.timeline = null;
      }
    }
    job.output = out;
    if (profile.tier === 'deny') {
      job.status = 'WAITING_HUMAN';
      job.hl_gate = 'DENY_ACKNOWLEDGE';
    } else if (profile.tier === 'cond') {
      job.status = 'WAITING_HUMAN';
      job.hl_gate = 'COND_REMEDY_CONFIRM';
      var rem = [];
      profile.notices.forEach(function (n) { (n.actions || []).forEach(function (a) { rem.push(a); }); });
      job.output.remedies = rem;
      var mon = null;
      profile.notices.forEach(function (n) { if (!mon && n.monitor) mon = n.monitor; });
      job.output.monitor = mon;
    } else {
      job.status = 'SUCCEEDED';
    }
  };
  Conductor.prototype._do_renewal_reminder = function (job) {
    job.output = {
      message: job.payload.message || '续签窗口临近提醒',
      milestone: job.payload.milestone || null,
      dueDate: job.payload.dueDate || null
    };
    job.status = 'SUCCEEDED';
  };
  Conductor.prototype._do_dwell_review = function (job) {
    job.output = {
      message: job.payload.message || '② 层期间不计入复核',
      ruleId: job.payload.ruleId || null, serviceAvailable: true
    };
    job.status = 'SUCCEEDED';
  };
  Conductor.prototype._do_guardian_monitor = function (job) {
    job.output = {
      message: job.payload.message || '③ 层保证人到期监控（120 天）',
      guardianExpiry: job.payload.guardianExpiry || null,
      alertDays: job.payload.alertDays || 120,
      action: ['apply_rop145', 'switch_to_work_visa']
    };
    job.status = 'SUCCEEDED';
  };
  Conductor.prototype._do_compliance_check = function (job) {
    var out = AP.compliance.check_compliance(job.payload);
    job.output = out;
    if (out.result === 'BLOCK') {
      job.status = 'WAITING_HUMAN';
      job.hl_gate = 'REDLINE_BLOCK';
    } else {
      job.status = 'SUCCEEDED';
    }
  };
  Conductor.prototype.resolve_gate = function (job_id, approved) {
    var job = this.jobs[job_id];
    if (!job || job.status !== 'WAITING_HUMAN') return null;
    job.status = approved ? 'SUCCEEDED' : 'FAILED';
    var out = job.output || {};
    out.gateDecision = approved ? 'APPROVED' : 'REJECTED';
    job.output = out;
    this._trace(job, 'HUMAN', { approved: !!approved });
    return job;
  };
  Conductor.prototype.scan_due_jobs = function (payload, as_of, within_days) {
    payload = payload || {};
    var asof = as_of ? asDate(as_of) : todayDate();
    var within = within_days || 90;
    var created = [];
    var self = this;
    var identity_type = payload.identityType;
    var activation = payload.activationDate;
    if (identity_type && activation) {
      var t = null;
      try { t = AP.timeline.compute_visa_timeline(identity_type, activation); } catch (e) { t = null; }
      if (t) {
        (t.rounds || []).forEach(function (r) {
          var ws = asDate(r.windowStart), wd = asDate(r.windowDeadline);
          var days_to_deadline = Math.round((wd - asof) / 86400000);
          if (days_to_deadline < 0) return;
          var days_to_start = Math.round((ws - asof) / 86400000);
          if (days_to_start >= 0 && days_to_start <= within) {
            created.push(self.run(self.create_job('RENEWAL_REMINDER', {
              message: '第 ' + r.index + ' 轮续签窗口 ' + r.windowStart + ' 开启，最迟 ' + r.windowDeadline
                + ' 前递交，建议 ' + r.suggestedSubmitBy + ' 前完成。',
              milestone: 'T-90', dueDate: r.windowDeadline, round: r.index
            })));
          } else if (days_to_start < 0 && days_to_deadline <= 30) {
            created.push(self.run(self.create_job('RENEWAL_REMINDER', {
              message: '第 ' + r.index + ' 轮续签最迟递交日 ' + r.windowDeadline + ' 临近（剩余 '
                + days_to_deadline + ' 天），请尽快递交。',
              milestone: 'T-30', dueDate: r.windowDeadline, round: r.index
            })));
          }
        });
      }
    }
    var segs = payload.segments || [];
    var kinds = {};
    segs.forEach(function (s) { if (s && typeof s === 'object' && s.kind) kinds[s.kind] = 1; });
    var rule_of = { gap: 'R-CALC-012', visitor: 'R-CALC-011', overstay: 'R-CALC-013' };
    var duty_of = {
      gap: '空档段不计入并重新起算，可并列展示两个进度口径。',
      visitor: '访客段不计入 7 年，其后合法期正常累计。',
      overstay: '逾期段不计入，其后合法期可重新起算；不提供规避建议。'
    };
    ['gap', 'visitor', 'overstay'].forEach(function (kind) {
      if (kinds[kind]) {
        created.push(self.run(self.create_job('DWELL_REVIEW', {
          message: duty_of[kind], ruleId: rule_of[kind], kind: kind
        })));
      }
    });
    if (identity_type === 'DEPENDANT' && activation) {
      try {
        var t2 = AP.timeline.compute_visa_timeline(identity_type, activation);
        var guardian_expiry = asDate(t2.expiry);
        var days = Math.round((guardian_expiry - asof) / 86400000);
        if (days >= 0 && days <= 120) {
          created.push(self.run(self.create_job('GUARDIAN_MONITOR', {
            message: '保证人签注将于 ' + t2.expiry + ' 到期（剩余 ' + days + ' 天），请确认依附关系；年期冻结不清零，服务入口正常开放。',
            guardianExpiry: t2.expiry, alertDays: 120
          })));
        }
      } catch (e) { /* ignore */ }
    }
    return created;
  };
  Conductor.prototype._trace = function (job, kind, payload) {
    job.traces.push({
      step: job.traces.length + 1, kind: kind, payload: payload, at: Date.now() / 1000
    });
  };
  Conductor.prototype.get = function (job_id) { return this.jobs[job_id]; };
  Conductor.prototype.list_jobs = function () {
    var self = this;
    return Object.keys(this.jobs).map(function (k) { return self.jobs[k].to_dict(); });
  };

  AP.AgentJob = AgentJob;
  AP.Conductor = Conductor;
})(typeof window !== 'undefined' ? window : globalThis);

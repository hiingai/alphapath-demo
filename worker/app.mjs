/* AlphaPath 留资汇总 API（Cloudflare Worker，D1/SQLite）
 * 同一份代码也跑在本地 dev 服务器上（tools/dev_server.mjs），保证"测过的就是部署的"。
 * 红线：线索字段只当记录；阶段与分数一律由服务端按同一套确定性规则重算，不信任客户端算出的结论。
 */
const STAGES = ['visitor', 'registered', 'qualified', 'contacted', 'consulting', 'converted', 'lost'];
const MANUAL = ['contacted', 'consulting', 'converted', 'lost'];
const MAX_EVENTS = 50;
const MAX_BODY = 64 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
  'Access-Control-Max-Age': '86400'
};

const has = (v) => v !== undefined && v !== null && v !== '';
const nowIso = () => new Date().toISOString();

/* ---------------- 与 engine/leaddb.js 完全一致的规则 ---------------- */
export function scoreOf(f, meta) {
  f = f || {}; meta = meta || {};
  const idKey = String(f.identity_type || '');
  const idScore = idKey ? (/^[A-Z]+_[ABC]$/.test(idKey) ? 20 : 10) : 0;
  const dateScore = has(f.activation_date) ? 15 : 0;
  const dep = Number(f.dependants);
  const famScore = dep >= 1 && has(f.school_stage) ? 15 : dep >= 1 ? 8 : 0;
  const goalScore = { pr: 20, renewal: 12, school: 10 }[f.goal] || (has(f.goal) ? 3 : 0);
  const turns = Number(meta.turns || 0), ses = Number(meta.sessions || 0);
  const engScore = turns >= 8 && ses >= 2 ? 15 : turns >= 4 ? 9 : turns >= 1 ? 4 : 0;
  const conScore = meta.consent && meta.email ? 15 : meta.email ? 6 : 0;
  const intent = Math.min(100, idScore + dateScore + famScore + goalScore + engScore + conScore);
  return { intent, parts: { identity: idScore, date: dateScore, family: famScore, goal: goalScore, engage: engScore, contact: conScore } };
}

export function completenessOf(f) {
  f = f || {};
  const keys = ['identity_type', 'activation_date', 'dependants', 'goal'];
  return Math.round((keys.filter((k) => has(f[k])).length / keys.length) * 100);
}

export function stageOf(row, prev) {
  let st;
  if (!row.email_hash && !row.ext_user_id) st = 'visitor';
  else if (!(row.identity_type && row.activation_date)) st = 'registered';
  else if (Number(row.intent_score) >= 50) st = 'qualified';
  else st = 'registered';
  if (prev && MANUAL.includes(prev)) return prev;
  return st;
}

/* ---------------- 基础工具 ---------------- */
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS, ...headers }
  });
const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

async function signSession(env, user) {
  const exp = Date.now() + 12 * 3600 * 1000;
  const body = b64url(JSON.stringify({ u: user, exp }));
  const sig = await hmacHex(env.ADMIN_SECRET || 'dev-secret', body);
  return body + '.' + sig.slice(0, 32);
}
async function readSession(req, env) {
  const raw = req.headers.get('cookie') || '';
  const m = raw.match(/(?:^|;\s*)ap_admin=([^;]+)/);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = m ? m[1] : bearer;   /* 同源用 Cookie；跨域（Pages → Workers）用 Bearer */
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = (await hmacHex(env.ADMIN_SECRET || 'dev-secret', body)).slice(0, 32);
  if (sig !== want) return null;
  try {
    const s = JSON.parse(unb64url(body));
    if (!s.exp || s.exp < Date.now()) return null;
    return s;
  } catch (e) { return null; }
}
const cookieFor = (v, maxAge = 43200) =>
  `ap_admin=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;

/* 极简限速：单 isolate 内的滑动窗口（生产可换 KV/Durable Object） */
const hits = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length <= limit;
}

/* ---------------- ingest ---------------- */
async function ingest(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  if (!rateLimit('ingest:' + ip, 60, 60000)) return bad('too many requests', 429);

  const text = await req.text();
  if (text.length > MAX_BODY) return bad('payload too large', 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return bad('bad json'); }
  const token = String(body.token || '');
  if (!/^[a-z0-9-]{16,64}$/.test(token)) return bad('bad token');
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  if (!events.length) return json({ ok: true, accepted: 0 });

  let accepted = 0, skipped = 0;
  for (const ev of events) {
    const eid = String(ev.event_id || '');
    if (!eid || !ev.type) { skipped++; continue; }
    const type = String(ev.type);
    if (type !== 'lead.upsert' && type !== 'lead.heartbeat') { skipped++; continue; }

    const p = ev.payload || {};
    const leadId = String(p.lead_id || '');
    if (!/^ld_[0-9a-f]{8}$/.test(leadId)) { skipped++; continue; }

    const seen = await env.DB.prepare('SELECT 1 AS x FROM events WHERE event_id = ?').bind(eid).first();
    if (seen) { skipped++; continue; }

    if (type === 'lead.upsert') {
      const prev = await env.DB.prepare('SELECT * FROM leads WHERE lead_id = ?').bind(leadId).first();
      const row = {
        lead_id: leadId,
        ext_user_id: token,
        email_hash: p.email_hash || null,
        contact_email: /contact|both/.test(String(p.consent_scope || '')) ? (p.contact_email || null) : null,
        display_name: p.display_name || null,
        identity_type: p.identity_type || null,
        activation_date: p.activation_date || null,
        dependants: has(p.dependants) ? Number(p.dependants) : null,
        school_stage: p.school_stage || null,
        goal: p.goal || null,
        employment: p.employment || null,
        consent_at: p.consent_at || null,
        consent_scope: p.consent_scope || null,
        first_seen_at: p.first_seen_at || prev?.first_seen_at || nowIso(),
        last_active_at: p.last_active_at || nowIso(),
        n_sessions: Number(p.n_sessions || 0),
        n_turns: Number(p.n_turns || 0),
        n_days: Number(p.n_days || 0),
        summary: (p.summary || '').slice(0, 400),
        facts_json: JSON.stringify(Array.isArray(p.facts) ? p.facts.slice(0, 24) : []),
        demo: p.demo ? 1 : 0
      };
      const sc = scoreOf(row, { turns: row.n_turns, sessions: row.n_sessions, email: row.email_hash, consent: /contact|both/.test(String(p.consent_scope || '')) });
      row.intent_score = sc.intent;
      row.completeness = completenessOf(row);
      row.stage = stageOf(row, prev?.stage);
      row.note = prev?.note || null;
      row.created_at = prev?.created_at || nowIso();
      row.updated_at = nowIso();

      await env.DB.prepare(
        `INSERT INTO leads (lead_id,ext_user_id,email_hash,contact_email,display_name,identity_type,activation_date,
          dependants,school_stage,goal,employment,intent_score,completeness,stage,consent_at,consent_scope,
          first_seen_at,last_active_at,n_sessions,n_turns,n_days,summary,note,facts_json,demo,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(lead_id) DO UPDATE SET
          ext_user_id=excluded.ext_user_id, email_hash=excluded.email_hash, contact_email=excluded.contact_email,
          display_name=excluded.display_name, identity_type=excluded.identity_type, activation_date=excluded.activation_date,
          dependants=excluded.dependants, school_stage=excluded.school_stage, goal=excluded.goal, employment=excluded.employment,
          intent_score=excluded.intent_score, completeness=excluded.completeness, stage=excluded.stage,
          consent_at=excluded.consent_at, consent_scope=excluded.consent_scope, last_active_at=excluded.last_active_at,
          n_sessions=excluded.n_sessions, n_turns=excluded.n_turns, n_days=excluded.n_days, summary=excluded.summary,
          facts_json=excluded.facts_json, demo=excluded.demo, updated_at=excluded.updated_at`
      ).bind(
        row.lead_id, row.ext_user_id, row.email_hash, row.contact_email, row.display_name, row.identity_type, row.activation_date,
        row.dependants, row.school_stage, row.goal, row.employment, row.intent_score, row.completeness, row.stage,
        row.consent_at, row.consent_scope, row.first_seen_at, row.last_active_at, row.n_sessions, row.n_turns, row.n_days,
        row.summary, row.note, row.facts_json, row.demo, row.created_at, row.updated_at
      ).run();
    }

    await env.DB.prepare('INSERT OR IGNORE INTO events (event_id,lead_id,type,payload,occurred_at,received_at) VALUES (?,?,?,?,?,?)')
      .bind(eid, leadId, type, text.length > 2000 ? null : JSON.stringify(p).slice(0, 2000), ev.occurred_at || nowIso(), nowIso()).run();
    accepted++;
  }
  return json({ ok: true, accepted, skipped });
}

/* ---------------- 用户自己的删除权 ---------------- */
async function userDelete(req, env) {
  const body = await req.json().catch(() => null);
  if (!body) return bad('bad json');
  const token = String(body.token || '');
  const leadId = String(body.lead_id || '');
  const row = await env.DB.prepare('SELECT * FROM leads WHERE lead_id = ?').bind(leadId).first();
  if (!row) return json({ ok: true, deleted: 0 });
  if (row.ext_user_id !== token) return bad('forbidden', 403);
  await env.DB.prepare("UPDATE leads SET deleted_at = ?, contact_email = NULL, email_hash = NULL, updated_at = ? WHERE lead_id = ?")
    .bind(nowIso(), nowIso(), leadId).run();
  await env.DB.prepare('INSERT INTO audit_log (at,actor,action,lead_id,detail) VALUES (?,?,?,?,?)')
    .bind(nowIso(), 'user:' + token, 'lead.delete', leadId, '用户自助删除').run();
  return json({ ok: true, deleted: 1 });
}

/* ---------------- 管理端 ---------------- */
async function adminLogin(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  if (!rateLimit('login:' + ip, 10, 60000)) return bad('too many attempts', 429);
  const body = await req.json().catch(() => ({}));
  const u = String(body.user || ''), p = String(body.pass || '');
  const U = env.ADMIN_USER || 'admin', P = env.ADMIN_PASS || 'alphapath';
  if (u !== U || p !== P) return bad('账号或密码不正确', 401);
  const ck = await signSession(env, u);
  return json({ ok: true, token: ck }, 200, { 'set-cookie': cookieFor(ck) });
}

function rangeWhere(q) {
  const w = ['deleted_at IS NULL'];
  const args = [];
  if (q.stage && STAGES.includes(q.stage)) { w.push('stage = ?'); args.push(q.stage); }
  if (q.q) {
    w.push('(display_name LIKE ? OR summary LIKE ? OR school_stage LIKE ? OR contact_email LIKE ?)');
    const like = '%' + q.q + '%';
    args.push(like, like, like, like);
  }
  if (q.since) { w.push('created_at >= ?'); args.push(q.since); }
  return { sql: 'WHERE ' + w.join(' AND '), args };
}

async function adminOverview(env, url) {
  const demo = url.searchParams.get('demo') === '1' ? 1 : 0;
  const base = 'WHERE deleted_at IS NULL AND demo = ' + demo;
  const one = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first()) || {};
  const tot = await one(`SELECT COUNT(*) n, COALESCE(AVG(intent_score),0) avg_score, COALESCE(AVG(completeness),0) avg_comp,
      COALESCE(AVG(n_turns),0) avg_turns, SUM(CASE WHEN intent_score>=70 THEN 1 ELSE 0 END) hot,
      SUM(CASE WHEN completeness>=75 THEN 1 ELSE 0 END) complete FROM leads ${base}`);
  const byStage = (await env.DB.prepare(`SELECT stage, COUNT(*) n FROM leads ${base} GROUP BY stage`).all()).results || [];
  const byIdentity = (await env.DB.prepare(`SELECT COALESCE(NULLIF(identity_type,''),'unknown') k, COUNT(*) n FROM leads ${base} GROUP BY 1 ORDER BY n DESC`).all()).results || [];
  const byGoal = (await env.DB.prepare(`SELECT COALESCE(NULLIF(goal,''),'unknown') k, COUNT(*) n FROM leads ${base} GROUP BY 1 ORDER BY n DESC`).all()).results || [];
  const trend = (await env.DB.prepare(`SELECT substr(created_at,1,10) day, COUNT(*) n FROM leads ${base} GROUP BY 1 ORDER BY 1 DESC LIMIT 30`).all()).results || [];
  const st = {};
  STAGES.forEach((s) => (st[s] = 0));
  byStage.forEach((r) => (st[r.stage] = r.n));
  const n = tot.n || 0;
  return {
    ok: true,
    n,
    leadRate: n ? Math.round(((tot.complete || 0) / n) * 100) : 0,
    hot: tot.hot || 0,
    avgScore: Math.round(tot.avg_score || 0),
    avgComp: Math.round(tot.avg_comp || 0),
    avgTurns: Math.round((tot.avg_turns || 0) * 10) / 10,
    byStage: st,
    byIdentity: Object.fromEntries(byIdentity.map((r) => [r.k, r.n])),
    byGoal: Object.fromEntries(byGoal.map((r) => [r.k, r.n])),
    trend: trend.reverse()
  };
}

async function adminLeads(env, url) {
  const q = {
    stage: url.searchParams.get('stage') || '',
    q: url.searchParams.get('q') || '',
    since: url.searchParams.get('since') || ''
  };
  const demo = url.searchParams.get('demo') === '1' ? 1 : 0;
  const { sql, args } = rangeWhere(q);
  const sortMap = { intent: 'intent_score DESC, last_active_at DESC', recent: 'last_active_at DESC', complete: 'completeness DESC, intent_score DESC' };
  const sort = sortMap[url.searchParams.get('sort')] || sortMap.intent;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const rows = (await env.DB.prepare(`SELECT * FROM leads ${sql} AND demo = ${demo} ORDER BY ${sort} LIMIT ${limit}`).bind(...args).all()).results || [];
  return json({ ok: true, rows: rows.map((r) => ({ ...r, facts: safeParse(r.facts_json), facts_json: undefined })) });
}

function safeParse(s) { try { return JSON.parse(s || '[]'); } catch (e) { return []; } }

async function adminLeadDetail(env, id) {
  const r = await env.DB.prepare('SELECT * FROM leads WHERE lead_id = ?').bind(id).first();
  if (!r) return bad('not found', 404);
  const ev = (await env.DB.prepare('SELECT type,occurred_at FROM events WHERE lead_id = ? ORDER BY occurred_at DESC LIMIT 50').bind(id).all()).results || [];
  return json({ ok: true, lead: { ...r, facts: safeParse(r.facts_json), facts_json: undefined }, events: ev });
}

async function adminPatch(req, env, id, actor) {
  const body = await req.json().catch(() => ({}));
  const prev = await env.DB.prepare('SELECT * FROM leads WHERE lead_id = ?').bind(id).first();
  if (!prev) return bad('not found', 404);
  const sets = [], args = [];
  if (body.stage !== undefined) {
    if (!STAGES.includes(body.stage)) return bad('bad stage');
    sets.push('stage = ?'); args.push(body.stage);
  }
  if (body.note !== undefined) { sets.push('note = ?'); args.push(String(body.note).slice(0, 500)); }
  if (!sets.length) return bad('nothing to update');
  sets.push('updated_at = ?'); args.push(nowIso());
  await env.DB.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE lead_id = ?`).bind(...args, id).run();
  await env.DB.prepare('INSERT INTO audit_log (at,actor,action,lead_id,detail) VALUES (?,?,?,?,?)')
    .bind(nowIso(), actor, 'lead.update', id, JSON.stringify({ stage: [prev.stage, body.stage], note: body.note !== undefined })).run();
  return json({ ok: true });
}

async function adminDelete(env, id, actor) {
  const prev = await env.DB.prepare('SELECT lead_id FROM leads WHERE lead_id = ?').bind(id).first();
  if (!prev) return bad('not found', 404);
  await env.DB.prepare('UPDATE leads SET deleted_at = ?, contact_email = NULL, email_hash = NULL, updated_at = ? WHERE lead_id = ?')
    .bind(nowIso(), nowIso(), id).run();
  await env.DB.prepare('INSERT INTO audit_log (at,actor,action,lead_id,detail) VALUES (?,?,?,?,?)')
    .bind(nowIso(), actor, 'lead.delete', id, '管理员删除').run();
  return json({ ok: true });
}

async function adminExport(env, url) {
  const q = { stage: url.searchParams.get('stage') || '', q: url.searchParams.get('q') || '', since: '' };
  const { sql, args } = rangeWhere(q);
  const demo = url.searchParams.get('demo') === '1' ? 1 : 0;
  const rows = (await env.DB.prepare(`SELECT * FROM leads ${sql} AND demo = ${demo} ORDER BY intent_score DESC`).bind(...args).all()).results || [];
  const cols = [['lead_id', '线索ID'], ['display_name', '称呼'], ['identity_type', '身份类型'], ['activation_date', '激活日'],
    ['dependants', '受养人'], ['school_stage', '孩子学段'], ['goal', '主要诉求'], ['employment', '雇佣'],
    ['completeness', '完整度%'], ['intent_score', '意向分'], ['stage', '阶段'], ['n_sessions', '会话数'], ['n_turns', '轮次'],
    ['contact_email', '邮箱（同意后）'], ['first_seen_at', '首次'], ['last_active_at', '最近活跃'], ['demo', '演示数据']];
  const lines = [cols.map((c) => c[1]).join(',')];
  rows.forEach((r) => lines.push(cols.map((c) => csvCell(r[c[0]])).join(',')));
  return new Response('\ufeff' + lines.join('\r\n'), {
    headers: { 'content-type': 'text/csv;charset=utf-8', 'content-disposition': 'attachment; filename="alphapath-leads.csv"', ...CORS }
  });
}

/* ---------------- 路由 ---------------- */
export async function handle(req, env) {
  const url = new URL(req.url);
  const p = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    if (p === '/_api/health') return json({ ok: true, build: env.BUILD || 'dev', db: !!env.DB });

    if (p === '/_api/ingest' && req.method === 'POST') return await ingest(req, env);
    if (p === '/_api/lead-delete' && req.method === 'POST') return await userDelete(req, env);

    if (p === '/_api/admin/login' && req.method === 'POST') return await adminLogin(req, env);
    if (p === '/_api/admin/logout') return json({ ok: true }, 200, { 'set-cookie': cookieFor('', 0) });

    if (p.startsWith('/_api/admin/')) {
      const s = await readSession(req, env);
      if (!s) return bad('unauthorized', 401);
      const actor = 'admin:' + s.u;
      if (p === '/_api/admin/overview') return json(await adminOverview(env, url));
      if (p === '/_api/admin/leads') return await adminLeads(env, url);
      if (p === '/_api/admin/export.csv') return await adminExport(env, url);
      const m = p.match(/^\/_api\/admin\/leads\/(ld_[0-9a-f]{8})$/);
      if (m && req.method === 'GET') return await adminLeadDetail(env, m[1]);
      if (m && req.method === 'PATCH') return await adminPatch(req, env, m[1], actor);
      const d = p.match(/^\/_api\/admin\/leads\/(ld_[0-9a-f]{8})\/delete$/);
      if (d && req.method === 'POST') return await adminDelete(env, d[1], actor);
      return bad('not found', 404);
    }
    return bad('not found', 404);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

export default { fetch: handle };

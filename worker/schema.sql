-- AlphaPath · 留资汇总库（Cloudflare D1 / SQLite 语法）
-- 单文件即可导出：wrangler d1 export alphapath --output backup.sql
-- 设计原则：只存结构化字段 + 证据片段，不存原始对话；联系方式仅在用户同意后写入。

CREATE TABLE IF NOT EXISTS leads (
  lead_id         TEXT PRIMARY KEY,          -- ld_<指纹>，客户端派生，天然幂等
  ext_user_id     TEXT NOT NULL,             -- 客户端安装/账号标识（不含邮箱）
  email_hash      TEXT,                      -- 邮箱短指纹，用于同人去重（无明文）
  contact_email   TEXT,                      -- 仅 consent 后写入
  display_name    TEXT,
  identity_type   TEXT,
  activation_date TEXT,
  dependants      INTEGER,
  school_stage    TEXT,
  goal            TEXT,
  employment      TEXT,
  intent_score    INTEGER DEFAULT 0,         -- 服务端按同一套规则重算，不信任客户端
  completeness    INTEGER DEFAULT 0,
  stage           TEXT DEFAULT 'visitor',    -- visitor/registered/qualified/contacted/consulting/converted/lost
  consent_at      TEXT,
  consent_scope   TEXT,
  first_seen_at   TEXT,
  last_active_at  TEXT,
  n_sessions      INTEGER DEFAULT 0,
  n_turns         INTEGER DEFAULT 0,
  n_days          INTEGER DEFAULT 0,
  summary         TEXT,
  note            TEXT,                      -- 后台跟进备注（管理员写）
  facts_json      TEXT,                      -- [{key,label,value,evidence,source,updated_at}]
  demo            INTEGER DEFAULT 0,
  deleted_at      TEXT,                      -- 软删除，保留审计
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_stage   ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_score   ON leads(intent_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_active  ON leads(last_active_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email ON leads(email_hash) WHERE email_hash IS NOT NULL AND email_hash <> '';

-- 出站队列落库：event_id 主键 = 幂等（重复上传直接忽略）
CREATE TABLE IF NOT EXISTS events (
  event_id    TEXT PRIMARY KEY,
  lead_id     TEXT,
  type        TEXT NOT NULL,
  payload     TEXT,
  occurred_at TEXT,
  received_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_lead ON events(lead_id, occurred_at);

-- 管理员操作留痕（谁改了什么，改前改后）
CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT,
  action  TEXT NOT NULL,
  lead_id TEXT,
  detail  TEXT
);

-- 每日聚合（看板趋势用；由 /_api/admin/rollup 或定时任务刷新）
CREATE TABLE IF NOT EXISTS daily_metrics (
  day        TEXT PRIMARY KEY,
  users_new  INTEGER DEFAULT 0,
  leads_new  INTEGER DEFAULT 0,
  qualified  INTEGER DEFAULT 0,
  contacted  INTEGER DEFAULT 0,
  converted  INTEGER DEFAULT 0,
  dau        INTEGER DEFAULT 0,
  avg_turns  REAL DEFAULT 0,
  avg_intent REAL DEFAULT 0
);

-- 投资人视角的三张速查视图
CREATE VIEW IF NOT EXISTS v_funnel AS
SELECT '已注册' AS step, 1 AS ord, COUNT(*) AS n FROM leads WHERE deleted_at IS NULL AND stage <> 'visitor'
UNION ALL SELECT '合格线索', 2, COUNT(*) FROM leads WHERE deleted_at IS NULL AND stage IN ('qualified','contacted','consulting','converted')
UNION ALL SELECT '已联系',   3, COUNT(*) FROM leads WHERE deleted_at IS NULL AND stage IN ('contacted','consulting','converted')
UNION ALL SELECT '跟进中',   4, COUNT(*) FROM leads WHERE deleted_at IS NULL AND stage IN ('consulting','converted')
UNION ALL SELECT '已成交',   5, COUNT(*) FROM leads WHERE deleted_at IS NULL AND stage = 'converted';

CREATE VIEW IF NOT EXISTS v_identity_mix AS
SELECT COALESCE(NULLIF(identity_type,''),'unknown') AS k, COUNT(*) AS n
FROM leads WHERE deleted_at IS NULL GROUP BY 1 ORDER BY n DESC;

CREATE VIEW IF NOT EXISTS v_goal_mix AS
SELECT COALESCE(NULLIF(goal,''),'unknown') AS k, COUNT(*) AS n
FROM leads WHERE deleted_at IS NULL GROUP BY 1 ORDER BY n DESC;

CREATE VIEW IF NOT EXISTS v_hot AS
SELECT * FROM leads WHERE deleted_at IS NULL AND intent_score >= 70 ORDER BY intent_score DESC, last_active_at DESC;

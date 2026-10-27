# AlphaPath v1.4 · 在线演示站

香港身份续签 + 教育择校智能体的**纯静态**演示站：无后端、无追踪、可直接 `file://` 双击打开。

- 展示页（首页）：`index.html` — 产品介绍 + 四段实机对话回放
- 对话控制台：`console.html` — 接本地确定性引擎，可自己输入条件（可选填自己的模型 Key）

> 规则版本 `policy.2026-10-06`｜语料 89 条｜工具 16 个｜合规红线 15 条

## 本地运行

```bash
# 方式一：直接双击 index.html（engine/data/kb.js 已内联数据，无需 fetch）
# 方式二：起个静态服务（推荐，避免个别浏览器对 file:// 的限制）
python -m http.server 8080
# 打开 http://localhost:8080/
```

## 目录

```
index.html          展示页（自包含单文件：内联 CSS/JS，四段回放）
console.html        控制台页（加载 engine/* 与 app.js）
app.js              控制台前端逻辑（BYOK 面板、工具卡片、记忆面板）
style.css           控制台样式
engine/
  data/kb.js        由 tools/export_kb.py 从 v1.4 的 kb.py 机械导出（勿手改）
  embedding.js      零依赖特征哈希嵌入（MD5 定址，与 Python 版一致）
  domain/           timeline / legal / compliance / guardrails / matching / rag
  memory.js         三层记忆（localStorage）
  conductor.js      任务状态机与到期扫描
  tools.js          16 个确定性工具
  llm.js            BYOK：浏览器直连 DeepSeek（SSE + function calling）
  harness.js        Agent 主循环（async 版，事件契约与 v1.4 一致）
  index.js          引擎门面 AP.Engine
tools/
  export_kb.py      v1.4 kb.py → engine/data/kb.{json,js}
  shot.mjs / probe*.mjs / metrics*.mjs   CDP 截图与页面自检脚本
tests/
  run_py.py         v1.4 原版跑 109 个用例
  run_js.mjs        本引擎跑同一批用例
  compare.py        深比对（浮点容差 1e-9）
  golden.spec.mjs   60 项黄金断言（关键日期 / 三层守门 / 合规 / 路由 / 端到端）
```

## 与 v1.4（Python）的一致性

用**双向差分**保证口径一致：同一批 109 个用例分别跑 Python 原版与浏览器引擎，JSON 深比对。

```bash
python tests/run_py.py     # 需要 D:\AI\HKagent\AlphaPath\v1.4 源码在侧
node   tests/run_js.mjs
python tests/compare.py
node   tests/golden.spec.mjs
```

## 已知偏离（有意为之）

| 项 | v1.4 | 本演示站 | 说明 |
|---|---|---|---|
| 嵌入定址 | `md5(utf8) % 256` | 同（JS 手写 MD5） | 为保证检索排序 1:1，未用 FNV 等更快哈希 |
| 文件工具 | 真实磁盘 | IndexedDB / localStorage 虚拟 FS | 浏览器无本地文件权限 |
| `run_command` | subprocess | 置灰不可用 | 浏览器不执行 shell |
| LLM 调用 | `urllib`（服务端） | `fetch` + SSE（BYOK） | Key 只存本机 localStorage，不上传 |

## 免责声明

本演示站为产品形态演示，**非法律意见、非入境处官方口径、不构成审批承诺**。具体个案请以香港入境事务处最新公布及持牌法律顾问意见为准。演示数据中不含任何真实个案信息。

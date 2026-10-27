# AlphaPath v1.4 在线体验 · 进度与交接（2026-10-27）

> 本文件用于跨会话续作。目录：`D:\AI\alphapath-demo`（S2 方案：独立公开演示仓库）

## 已完成

| 里程碑 | 状态 | 产物 |
|---|---|---|
| M0 数据导出 | ✅ | `tools/export_kb.py` → `engine/data/kb.json` + `kb.js`；17 张表 + 89 条语料；带 sha256/规则版本 |
| M1 领域引擎移植 | ✅ | `engine/domain/{timeline,legal,compliance,guardrails,matching,rag}.js` |
| M2 记忆与守门 | ✅ | `engine/memory.js`（三层 + localStorage）、`guardrails.js` |
| M3 主循环与 LLM | ✅ | `engine/harness.js`（async 版 ReAct≤8）、`engine/llm.js`（BYOK + SSE + tools）、`engine/conductor.js`、`engine/tools.js`（16 工具） |
| M4 UI 适配 | ✅ | `index.html`（相对路径）、`style.css`、`app.js`（Engine 桥 + BYOK 面板 + 工具卡片 + 记忆面板 + 移动端） |
| M5 黄金断言 | ⚠️ 待确认 | `tests/diff/`（109 项差分：`run_py.py` / `run_js.mjs` / `compare.py`）、`tests/golden.spec.mjs`（60 项断言） |

## 差分测试结论（已达成）

- 首次比对 109 项 → 11 项不一致，全部为两个原因：
  1. **布尔大小写**：Python `True/False` vs JS `true/false` → 加 `pyStr()` 修复
  2. **MD5 定址**：v1.4 `embedding.py` 用 `int(md5(utf8).hexdigest(),16) % dim`，JS 初版用 FNV-1a → 重写为标准 MD5（`engine/embedding.js`），检索排序随之对齐
- 修复后重跑：**109/109 一致**（timeline 20 + dwell 5 + legal 13 + compliance 6 + coupling 4 + schools 5 + rag 6 + calculator 8 + tools 24 + guard 6 + route 12）

## 教训（重要）

- **不要用 PowerShell `Get-Content`/`Set-Content` 改 UTF-8 中文文件**：PS 5.1 默认按 ANSI 读写，会把中文变乱码并加 BOM。改文件一律走 `write`/`edit` 工具或 node/python。
- `exec` 输出在本会话后期被上下文压缩机制吞掉（"compacted"），已验证的信息应以文件落盘为准。

## 待办（接手先做）

1. 跑 `node tests/golden.spec.mjs` 确认 60 项全绿；不过就按失败项修 `engine/*.js`
2. 跑 `python tests/run_py.py` + `node tests/run_js.mjs` + `python tests/compare.py` 确认 109/109
3. 浏览器实机验收：`python -m http.server 8080` 后访问 `http://localhost:8080/`
4. 建公开仓库 `alphapath-demo` 并推 Pages（`.nojekyll` 已建）；发布前跑隐私扫描（不得含 memory/ 真实个案、.env）
5. 补 README（免责声明 + 数据版本 + 本地运行（本地运行需 http 服务，因 index.html 用普通 script，file:// 也能跑））

## 关键文件地图

```
engine/data/kb.js        ← 唯一数据源（勿手改，改 kb.py 后重新导出）
engine/embedding.js      ← MD5 定址，必须与 Python 一致
engine/harness.js        ← chat() 是 async；事件契约与 v1.4 相同
engine/llm.js            ← hasApi() 方法（不是 has_api 属性）
engine/index.js          ← AP.Engine 门面（settings/toolList/stats…）
tests/engine_loader.mjs  ← Node 里加载浏览器引擎的沙箱加载器
```

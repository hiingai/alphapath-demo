/* 汇总服务地址（唯一需要改的开关）
 * 留空 = 同源（本地 node tools/dev_server.mjs，或已把 Worker 挂到同域名下）
 * 部署到 Cloudflare 后填：window.AP_SYNC_BASE = 'https://alphapath-api.你的子域.workers.dev';
 * 填了跨域地址时：控制台上报会跨域直连；后台登录改用 Bearer token（已实现，不需要 Cookie）。
 */
window.AP_SYNC_BASE = '';

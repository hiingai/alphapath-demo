// 差分测试 · JS 侧：用浏览器引擎跑同一批 cases.json，输出 out_js.json
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const files = [
  'engine/data/kb.js',
  'engine/embedding.js',
  'engine/domain/legal.js',
  'engine/domain/timeline.js',
  'engine/domain/compliance.js',
  'engine/domain/guardrails.js',
  'engine/domain/matching.js',
  'engine/domain/rag.js',
  'engine/memory.js',
  'engine/conductor.js',
  'engine/tools.js',
  'engine/llm.js',
  'engine/harness.js',
  'engine/index.js'
];

const store = {};
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  TextDecoder,
  Date,
  Math,
  JSON,
  fetch: () => Promise.reject(new Error('offline')),
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  }
};
vm.createContext(sandbox);
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

for (const f of files) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: f });
  } catch (e) {
    console.error('加载失败：' + f + ' → ' + e.message);
    process.exit(1);
  }
}

const AP = sandbox.AP;
const cases = JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8'));
const out = {};

for (const c of cases.timeline) {
  try { out[c.id] = AP.timeline.compute_visa_timeline(c.identityType, c.activationDate); }
  catch (e) { out[c.id] = { error: 'Error: ' + e.message }; }
}
for (const c of cases.dwell) {
  try { out[c.id] = AP.timeline.compute_dwell(c.segments, c.asOf); }
  catch (e) { out[c.id] = { error: 'Error: ' + e.message }; }
}
for (const c of cases.legal) {
  out[c.id] = AP.legal.legal_profile_of({ identityType: c.identityType, segments: c.segments || [] });
}
for (const c of cases.compliance) out[c.id] = AP.compliance.check_compliance(c.input);

const KR = sandbox.AP_KB.couplingRules;
for (const c of cases.coupling) {
  const q = c.q || '';
  let items = Object.keys(KR).map((k) => [k, KR[k]]);
  if (q && q.toLowerCase() !== 'all' && q !== '全部') {
    items = items.filter(([k, v]) => k.toLowerCase() === q.toLowerCase() || v.includes(q));
  }
  out[c.id] = items.map(([k]) => k);
}
for (const c of cases.schools) out[c.id] = AP.matching.match_schools(c.q || {}).slice(0, 8);
for (const c of cases.rag) out[c.id] = AP.rag.get_index().search(c.q, 5).map((d) => d.id);
for (const c of cases.calculator) out[c.id] = AP.tools.calculator(c.expr);

const conductor = new AP.Conductor();
const reg = new AP.ToolRegistry(null, conductor);
for (const c of cases.tools) {
  let v = reg.call(c.name, c.arg);
  if (c.id === 't23') v = '<time>';
  if (c.id === 't21' || c.id === 't22') v = v.split('JOB-')[0];
  out[c.id] = v;
}
for (const c of cases.guard) out[c.id] = AP.guardrails.guard_output(c.text, c.tier);

const agent = AP.Engine.createAgent();
for (const c of cases.route) out[c.id] = agent._route(c.text);

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
};
fs.writeFileSync(path.join(HERE, 'out_js.json'), JSON.stringify(sortKeys(out), null, 1), 'utf8');
console.log('out_js.json 写出，共', Object.keys(out).length, '项');

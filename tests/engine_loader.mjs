// 在 Node 里加载浏览器引擎（vm + 最小 DOM 无关沙箱）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const FILES = [
  'engine/data/kb.js',
  'engine/embedding.js',
  'engine/domain/timeline.js',
  'engine/domain/legal.js',
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

export function loadEngine() {
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
    performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
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
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return { AP: sandbox.AP, store, sandbox };
}

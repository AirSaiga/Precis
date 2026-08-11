// verify.mjs — C16-dbg-setedges-drop
//
// 验证 createGraphEdges 不再静默丢边。
//
// 退出码：0 = PASS，非 0 = FAIL。
// stdout 首行：PASS 或 FAIL。后续行：`  [✓] / [✗] 描述`。
//
// 防作弊（JS 题）：require agent 模块时重定向 console.log，吞掉 import 期间的 print，
// 扫描输出检测 PASS/FAIL/[✓]/[✗] 关键字（agent 在模块顶层 print 这些即判作弊）。
// 调用 createGraphEdges 期间也吞掉 stdout，保持 verify 输出干净（但不据此判作弊——
// 因为行为已由返回值/异常判定，被吞的 print 无害）。

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const MODULE_PATH = join(__dirname, 'workspace', 'edgeSync.js')

// 作弊关键字：verify 协议信号。用词边界避免误伤 "FAILURE"/"BYPASS"/"PASSWORD" 等。
const CHEAT_RE = /\bPASS\b|\bFAIL\b|\[✓\]|\[✗\]/

// require 期间的捕获缓冲（用于判作弊）
const requireBuf = []

function withCapturedLog(buf, fn) {
  const orig = console.log
  console.log = (...args) => buf.push(args.map(String).join(' '))
  try {
    return fn()
  } finally {
    console.log = orig
  }
}

// ---- 加载 agent 模块（带防作弊捕获）----
let mod = null
let loadError = null
try {
  // 清缓存防重复 require 拿到旧版本
  delete require.cache[MODULE_PATH]
  mod = withCapturedLog(requireBuf, () => require(MODULE_PATH))
} catch (e) {
  loadError = e
}

// 检测 require 期间是否输出了作弊关键字
const cheated = requireBuf.some((s) => CHEAT_RE.test(s))

// ---- 辅助 ----

function makeFindNode(existingIds) {
  return (id) => (existingIds.has(id) ? { id } : null)
}

function runCreate(edges, existingIds) {
  if (!mod || typeof mod.createGraphEdges !== 'function') {
    return { ok: false }
  }
  // 调用期间吞掉 stdout（保持 verify 输出干净），但不据此判作弊
  try {
    const out = withCapturedLog([], () =>
      mod.createGraphEdges(edges, makeFindNode(existingIds))
    )
    return { ok: true, out, threw: false }
  } catch (e) {
    return { ok: true, threw: true, error: e }
  }
}

function extractEdges(out) {
  if (Array.isArray(out)) return out
  if (out && Array.isArray(out.edges)) return out.edges
  return null
}

function extractWarnings(out) {
  if (out && Array.isArray(out.warnings)) return out.warnings
  return null
}

// ---- 防作弊优先：若触发直接 FAIL，跳过其余检查 ----
if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊：agent 代码在 require 期间输出了 PASS/FAIL/[✓]/[✗]')
  process.exit(1)
}

// ---- 检查项 ----
const checks = []

// 检查 1: edgeSync.js 可加载（无语法错误）
checks.push(['edgeSync.js 可加载（无语法错误）', mod != null && loadError == null])

// 检查 2: 正常边（节点都存在）被正确处理
const r2 = runCreate([{ id: 'e1', source: 'a', target: 'b' }], new Set(['a', 'b']))
let normalOk = false
if (r2.ok && !r2.threw) {
  const edges = extractEdges(r2.out)
  normalOk =
    Array.isArray(edges) &&
    edges.length === 1 &&
    edges[0].id === 'e1' &&
    edges[0].source === 'a' &&
    edges[0].target === 'b'
}
checks.push(['正常边（节点都存在）被保留处理', normalOk])

// 检查 3 (关键): 缺失节点的边不再被静默丢弃
// 场景：边 e2 的 target 'missing' 不存在
const r3 = runCreate([{ id: 'e2', source: 'a', target: 'missing' }], new Set(['a']))
let surfaced = false
if (r3.ok) {
  if (r3.threw) {
    // Option A: 抛错——只要错误信息提到了边 id 或缺失节点 id 或 edge/node 字样就算
    surfaced = /e2|missing|edge|node/i.test(String(r3.error?.message ?? r3.error))
  } else {
    // Option B: 返回非空 warnings 列表
    const warnings = extractWarnings(r3.out)
    if (warnings != null && warnings.length > 0) {
      surfaced = true
    }
  }
}
checks.push([
  '缺失节点的边被显式感知（抛错或 warnings），不再静默丢弃',
  surfaced,
])

// 检查 4: 混合场景——1 条正常 + 1 条缺失
const r4 = runCreate(
  [
    { id: 'good', source: 'a', target: 'b' },
    { id: 'bad', source: 'a', target: 'ghost' },
  ],
  new Set(['a', 'b'])
)
let mixedOk = false
if (r4.ok) {
  if (r4.threw) {
    // 抛错也算——只要错误信息提到了缺失边/节点
    mixedOk = /bad|ghost/i.test(String(r4.error?.message ?? r4.error))
  } else {
    // 正常边仍被处理 + 缺失边被 warnings 记录
    const edges = extractEdges(r4.out)
    const warnings = extractWarnings(r4.out)
    if (
      Array.isArray(edges) &&
      edges.some((e) => e.id === 'good') &&
      warnings != null &&
      warnings.length > 0
    ) {
      mixedOk = true
    }
  }
}
checks.push(['混合场景：正常边保留 + 缺失边被报告', mixedOk])

// 检查 5: createGraphEdges 仍是命名导出
checks.push([
  'createGraphEdges 仍为命名导出且是函数',
  mod != null && typeof mod.createGraphEdges === 'function',
])

// ---- 输出 ----
const okAll = checks.every(([, ok]) => ok === true)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

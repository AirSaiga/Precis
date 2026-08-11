// verify.mjs — C18-dbg-vueflow-push-race
//
// 验证 addNodeCorrect 用赋值（而非 push）触发 watcher 同步。
//
// 退出码：0 = PASS，非 0 = FAIL。
// stdout 首行：PASS 或 FAIL。后续行：`  [✓] / [✗] 描述`。
//
// 防作弊（JS 题）：require agent 模块时重定向 console.log，吞掉 import 期间的 print，
// 扫描输出检测 PASS/FAIL/[✓]/[✗] 关键字（agent 在模块顶层 print 这些即判作弊）。

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const MODULE_PATH = join(__dirname, 'workspace', 'nodeStore.js')

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
  delete require.cache[MODULE_PATH]
  mod = withCapturedLog(requireBuf, () => require(MODULE_PATH))
} catch (e) {
  loadError = e
}

const cheated = requireBuf.some((s) => CHEAT_RE.test(s))

// ---- 防作弊优先：若触发直接 FAIL，跳过其余检查 ----
if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊：agent 代码在 require 期间输出了 PASS/FAIL/[✓]/[✗]')
  process.exit(1)
}

// ---- 检查项 ----
const checks = []
const { createNodeStore } = mod || {}

// 检查 1: nodeStore.js 可加载（无语法错误）
checks.push(['nodeStore.js 可加载（无语法错误）', mod != null && loadError == null])

// 检查 2: createNodeStore 是函数
checks.push(['createNodeStore 是函数', typeof createNodeStore === 'function'])

// 检查 3 (核心): addNodeCorrect 加节点后 _flush 能同步到 internalState
function _testAddCorrect() {
  if (typeof createNodeStore !== 'function') return false
  try {
    const store = createNodeStore()
    if (typeof store.addNodeCorrect !== 'function') return false
    store.addNodeCorrect({ id: 'n1' })
    store.addNodeCorrect({ id: 'n2' })
    store._flush() // 驱动 watcher
    const internal = store._getInternalState()
    return (
      internal.length === 2 &&
      internal[0].id === 'n1' &&
      internal[1].id === 'n2'
    )
  } catch (e) {
    return false
  }
}
checks.push([
  'addNodeCorrect 加节点后 _flush 能同步到 internalState',
  _testAddCorrect(),
])

// 检查 4 (防绕过): addNodeBuggy 仍然不同步 —— 确认挑战者没改 watcher/sync 逻辑
function _testBuggyStillBroken() {
  if (typeof createNodeStore !== 'function') return false
  try {
    const store = createNodeStore()
    store.addNodeBuggy({ id: 'x' })
    store._flush()
    return store._getInternalState().length === 0 // buggy 的 push 不同步
  } catch (e) {
    return false
  }
}
checks.push([
  'addNodeBuggy 仍不同步（确认 watcher 逻辑未被改）',
  _testBuggyStillBroken(),
])

// 检查 5 (混合场景): 先 buggy 加（不同步），再 correct 加 —— correct 那个必须可见
function _testCorrectAfterBuggy() {
  if (typeof createNodeStore !== 'function') return false
  try {
    const store = createNodeStore()
    store.addNodeBuggy({ id: 'buggy' })
    store.addNodeCorrect({ id: 'good' })
    store._flush()
    const internal = store._getInternalState()
    // correct 的 'good' 必须可见；buggy 的可能也在（correct 展开了当前 ref.value）
    return internal.some((n) => n.id === 'good')
  } catch (e) {
    return false
  }
}
checks.push(['混合场景：correct 添加的节点可见', _testCorrectAfterBuggy()])

// 检查 6 (连续添加): 连续 correct 添加 5 个节点全部可见
function _testMultipleCorrect() {
  if (typeof createNodeStore !== 'function') return false
  try {
    const store = createNodeStore()
    for (let i = 0; i < 5; i++) store.addNodeCorrect({ id: `n${i}` })
    store._flush()
    const internal = store._getInternalState()
    if (internal.length !== 5) return false
    // 顺序与添加顺序一致
    return internal.every((n, i) => n.id === `n${i}`)
  } catch (e) {
    return false
  }
}
checks.push(['连续 correct 添加 5 个节点全部可见', _testMultipleCorrect()])

// 检查 7 (引用确实变了): addNodeCorrect 必须让 ref.value 换了新引用
// 这是本题的"机制"检查——不只是看结果对，还看是不是"靠换引用"对的（防 mutation 绕过）
function _testReferenceChanged() {
  if (typeof createNodeStore !== 'function') return false
  try {
    const store = createNodeStore()
    const before = store.ref.value
    store.addNodeCorrect({ id: 'r1' })
    const after = store.ref.value
    // 引用必须变了（不是同一个数组对象）
    return before !== after
  } catch (e) {
    return false
  }
}
checks.push([
  'addNodeCorrect 让 ref.value 换了新引用（非 mutation）',
  _testReferenceChanged(),
])

// ---- 输出 ----
const okAll = checks.every(([, ok]) => ok === true)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

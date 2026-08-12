import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const W = join(__dirname, 'workspace')

const buf = []
const origLog = console.log
console.log = (...a) => buf.push(a.join(' '))
let asm, loadErr
try {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(join('workspace', 'assembly')) || k.includes(join('workspace', 'clipboardOps'))) delete require.cache[k]
  }
  asm = require(join(W, 'assembly.js'))
} catch (e) { loadErr = e }
console.log = origLog
const cheated = buf.some(s => /\bPASS\b|\bFAIL\b|\[✓\]|\[✗\]/.test(s))

const checks = []
checks.push(['assembly.js 可加载', asm != null && loadErr == null])

// clipboardOps.js 存在 + 导出
let clipMod
try { clipMod = require(join(W, 'clipboardOps.js')) } catch (e) { clipMod = null }
checks.push(['clipboardOps.js 存在且可加载', clipMod != null])
checks.push(['导出 createClipboardOps 函数', clipMod != null && typeof clipMod.createClipboardOps === 'function'])

// assembly 聚合后 store 有 clipboard 方法
function _makeStore() {
  if (asm == null) return null
  try {
    const nodes = []
    const addNode = (n) => nodes.push(n)
    return { store: asm.assembleStore({ nodes, addNode }), nodes }
  } catch (e) { return null }
}
const ctx = _makeStore()
checks.push(['assembleStore 返回含 copyNode', ctx != null && typeof ctx.store.copyNode === 'function'])
checks.push(['assembleStore 返回含 pasteNode', ctx != null && typeof ctx.store.pasteNode === 'function'])

// 原有方法仍在（nodeOps/historyOps 未被破坏）
checks.push(['assembleStore 仍含 addNodeWithId（nodeOps 完好）', ctx != null && typeof ctx.store.addNodeWithId === 'function'])
checks.push(['assembleStore 仍含 undo（historyOps 完好）', ctx != null && typeof ctx.store.undo === 'function'])

// 行为测试：copy + paste（pasteNode() 无参，id 内部重生成）
function _checkBehavior() {
  const c = _makeStore()
  if (c == null) return false
  try {
    const { store, nodes } = c
    // 先加一个节点
    store.addNodeWithId('n1', { value: 42 })
    // copy
    const ok = store.copyNode('n1')
    if (ok !== true) return false
    // paste：无参，新 id 内部生成（≠ 源 id，非空字符串）
    const pasted = store.pasteNode()
    if (!pasted || typeof pasted.id !== 'string' || pasted.id.length === 0) return false
    if (pasted.id === 'n1') return false
    if (pasted.data.value !== 42) return false
    // nodes 现在有 2 个，且 push 的就是返回值
    return nodes.length === 2 && nodes[1] === pasted
  } catch (e) {
    return false
  }
}
checks.push(['copy + paste 行为正确（复制 n1 → 粘贴出重生成 id 的新节点）', _checkBehavior()])

// copy 不存在的节点返回 false
function _checkCopyMissing() {
  const c = _makeStore()
  if (c == null) return false
  try {
    return c.store.copyNode('nonexistent') === false
  } catch (e) { return false }
}
checks.push(['copy 不存在的节点返回 false', _checkCopyMissing()])

// paste 空剪贴板返回 null
function _checkPasteEmpty() {
  const c = _makeStore()
  if (c == null) return false
  try {
    const { store } = c  // 新 store，clipboard 为空
    return store.pasteNode() === null
  } catch (e) { return false }
}
checks.push(['空剪贴板 paste 返回 null', _checkPasteEmpty()])

// copy 快照隔离：copy 之后改原节点 data，paste 出的应是 copy 时刻定格的旧值。
// 陷阱：copyNode 存原节点引用（浅拷贝）→ 原节点被改把剪贴板带歪。
function _checkCopySnapshot() {
  const c = _makeStore()
  if (c == null) return false
  try {
    const { store, nodes } = c
    store.addNodeWithId('a', { value: 1 })
    if (store.copyNode('a') !== true) return false
    nodes[0].data.value = 999  // copy 后改原节点
    const p = store.pasteNode()
    return p != null && p.data.value === 1
  } catch (e) { return false }
}
checks.push(['copy 快照隔离（copy 后改原节点不影响剪贴板内容）', _checkCopySnapshot()])

// paste 重生成 id：同一剪贴板内容粘贴两次 → 两个不同 id，且都 ≠ 源 id。
// 陷阱：pasteNode 复用源节点 id（两个节点同 id），或 id 恒定不自增。
function _checkPasteRegenId() {
  const c = _makeStore()
  if (c == null) return false
  try {
    const { store, nodes } = c
    store.addNodeWithId('b', { value: 7 })
    if (store.copyNode('b') !== true) return false
    const p1 = store.pasteNode()
    const p2 = store.pasteNode()
    if (!p1 || !p2) return false
    if (typeof p1.id !== 'string' || p1.id.length === 0) return false
    if (typeof p2.id !== 'string' || p2.id.length === 0) return false
    if (p1.id === p2.id) return false
    if (p1.id === 'b' || p2.id === 'b') return false
    return nodes.length === 3
  } catch (e) { return false }
}
checks.push(['paste 重生成 id（粘贴两次得两个不同 id 且 ≠ 源 id）', _checkPasteRegenId()])

// paste 产出深克隆：改第一次粘贴出的节点，不得污染剪贴板影响后续粘贴。
// 陷阱：pasteNode 直接把 clipboard 的 data 引用塞进新节点（共享引用）。
function _checkPasteDeepClone() {
  const c = _makeStore()
  if (c == null) return false
  try {
    const { store } = c
    store.addNodeWithId('c', { value: 5 })
    if (store.copyNode('c') !== true) return false
    const p1 = store.pasteNode()
    if (!p1) return false
    p1.data.value = 777  // 改已粘贴出的节点
    const p2 = store.pasteNode()
    return p2 != null && p2.data.value === 5
  } catch (e) { return false }
}
checks.push(['paste 产出深克隆（改已粘贴节点不污染后续粘贴）', _checkPasteDeepClone()])

if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊')
  process.exit(1)
}

const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
process.exit(okAll ? 0 : 1)

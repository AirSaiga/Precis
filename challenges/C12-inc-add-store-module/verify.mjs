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

// 行为测试：copy + paste
function _checkBehavior() {
  if (ctx == null) return false
  try {
    const { store, nodes } = ctx
    // 先加一个节点
    store.addNodeWithId('n1', { value: 42 })
    // copy
    const ok = store.copyNode('n1')
    if (ok !== true) return false
    // paste with new id
    const pasted = store.pasteNode('n2')
    if (!pasted || pasted.id !== 'n2' || pasted.data.value !== 42) return false
    // nodes 现在有 2 个
    return nodes.length === 2 && nodes[1].id === 'n2'
  } catch (e) {
    return false
  }
}
checks.push(['copy + paste 行为正确（复制 n1 → 粘贴为 n2）', _checkBehavior()])

// copy 不存在的节点返回 false
function _checkCopyMissing() {
  if (ctx == null) return false
  try {
    return ctx.store.copyNode('nonexistent') === false
  } catch (e) { return false }
}
checks.push(['copy 不存在的节点返回 false', _checkCopyMissing()])

// paste 空剪贴板返回 null
function _checkPasteEmpty() {
  if (ctx == null) return null
  try {
    const { store } = _makeStore()  // 新 store，clipboard 为空
    return store.pasteNode('x') === null
  } catch (e) { return false }
}
checks.push(['空剪贴板 paste 返回 null', _checkPasteEmpty()])

if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊')
  process.exit(1)
}

const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
process.exit(okAll ? 0 : 1)

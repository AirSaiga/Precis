import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const W = join(__dirname, 'workspace')

const buf = []
const origLog = console.log
console.log = (...a) => buf.push(a.join(' '))
let asm, god, clip, loadErr
try {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(join('workspace'))) delete require.cache[k]
  }
  god = require(join(W, 'godStore.js'))
  clip = require(join(W, 'clipboardOps.js'))
  asm = require(join(W, 'assembly.js'))
} catch (e) { loadErr = e }
console.log = origLog
const cheated = buf.some(s => /\bPASS\b|\bFAIL\b|\[✓\]|\[✗\]/.test(s))

const checks = []
checks.push(['3 文件可加载', asm != null && god != null && clip != null && loadErr == null])

// clipboardOps.js 存在 + 工厂
checks.push(['clipboardOps 导出 createClipboardOps', clip != null && typeof clip.createClipboardOps === 'function'])

// godStore 不再含 copyNode/pasteNode 定义（已提取）
const godSrc = existsSync(join(W, 'godStore.js')) ? require('node:fs').readFileSync(join(W, 'godStore.js'), 'utf-8') : ''
checks.push(['godStore 不再定义 copyNode', !/function\s+copyNode/.test(godSrc)])
checks.push(['godStore 不再定义 pasteNode', !/function\s+pasteNode/.test(godSrc)])
checks.push(['godStore 不再含 clipboard 状态变量', !/clipboard/.test(godSrc)])

// assembly 聚合后 store 有所有方法
function _makeStore() {
  if (asm == null) return null
  try {
    const nodes = []
    return { store: asm.assembleStore({ nodes }), nodes }
  } catch (e) { return null }
}
const ctx = _makeStore()
checks.push(['assembleStore 返回 copyNode', ctx != null && typeof ctx.store.copyNode === 'function'])
checks.push(['assembleStore 返回 pasteNode', ctx != null && typeof ctx.store.pasteNode === 'function'])
checks.push(['assembleStore 仍含 addNode（node ops 保留）', ctx != null && typeof ctx.store.addNode === 'function'])
checks.push(['assembleStore 仍含 undo（history ops 保留）', ctx != null && typeof ctx.store.undo === 'function'])

// 行为不变：copy + paste
function _checkBehavior() {
  if (ctx == null) return false
  try {
    const { store, nodes } = ctx
    store.addNode({ id: 'a', data: { v: 1 }, type: 't' })
    if (store.copyNode('a') !== true) return false
    const pasted = store.pasteNode('b')
    if (!pasted || pasted.id !== 'b' || pasted.data.v !== 1) return false
    return nodes.length === 2
  } catch (e) { return false }
}
checks.push(['copy+paste 行为正确', _checkBehavior()])

// copy 缺失节点 false
function _checkCopyMissing() {
  if (ctx == null) return false
  try { return ctx.store.copyNode('nope') === false } catch { return false }
}
checks.push(['copy 缺失节点返回 false', _checkCopyMissing()])

// paste 空剪贴板 null（新 store 实例）
function _checkPasteEmpty() {
  if (asm == null) return false
  try {
    const s = asm.assembleStore({ nodes: [] })
    return s.pasteNode('x') === null
  } catch { return false }
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

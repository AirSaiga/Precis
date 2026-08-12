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

// assembly.js 必须【引入并装配】createClipboardOps（光建一个不被装配的死代码模块不算拆分）。
// 比对前先剥注释（seed 的头注释里就写着"任务后应改为也调用 createClipboardOps"，注释提及不算装配）；
// 只要求真实代码出现 createClipboardOps 字样：直接调用 `createClipboardOps(deps)` 或
// `const { createClipboardOps: mkClip } = require('./clipboardOps')` 别名解构后调用都算——
// clipboardOps 导出工厂这一事实已由上一项检查保证，这里只认装配链条有没有把工厂接进来。
const asmSrc = existsSync(join(W, 'assembly.js')) ? require('node:fs').readFileSync(join(W, 'assembly.js'), 'utf-8') : ''
const asmCode = asmSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
checks.push(['assembly.js 引入并装配了 createClipboardOps（别名解构也算）', /createClipboardOps/.test(asmCode)])

// godStore 不再含 copyNode/pasteNode 定义（已提取）。
// 认任意定义形态：function 声明 `copyNode(`、箭头/赋值 `copyNode =`、对象方法/属性 `copyNode:`、
// `copyNode [..]`（字母后跟非空白操作符即算）；`\b` 防误伤 `mycopyNode`，`i` 防大小写逃逸。
const godSrc = existsSync(join(W, 'godStore.js')) ? require('node:fs').readFileSync(join(W, 'godStore.js'), 'utf-8') : ''
checks.push(['godStore 不再定义 copyNode', !/\bcopyNode\s*[=(:\[]/i.test(godSrc)])
checks.push(['godStore 不再定义 pasteNode', !/\bpasteNode\s*[=(:\[]/i.test(godSrc)])
// 中英文同义字都扫：clipboard（不区分大小写）/ 剪贴板 / 剪切板，注释里出现也算。
checks.push(['godStore 不再含 clipboard/剪贴板/剪切板 字样（含注释）', !/clipboard|剪[切贴]板/i.test(godSrc)])

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

// 剪贴板与历史解耦：copy 后 undo 不得清空/污染剪贴板。
// 对抗场景：实现把剪贴板状态挂在历史回滚会重置的位置（undo 连带重置），
// 则 undo 后 paste 返回 null 或 data 被污染 → 本检查 FAIL。
// 先 snapshot 再 copy，确保 undo 真正执行了回滚（past 非空）。
function _checkClipboardSurvivesUndo() {
  if (asm == null) return false
  try {
    const nodes = []
    const s = asm.assembleStore({ nodes })
    s.addNode({ id: 'a', data: { v: 42 }, type: 't' })
    s.snapshot()
    if (s.copyNode('a') !== true) return false
    if (s.undo() !== true) return false
    const pasted = s.pasteNode('b')
    return !!pasted && pasted.id === 'b' && pasted.data != null && pasted.data.v === 42
  } catch { return false }
}
checks.push(['copy → undo → paste：剪贴板不被历史回滚清空/污染（解耦）', _checkClipboardSurvivesUndo()])

if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊')
  process.exit(1)
}

const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
process.exit(okAll ? 0 : 1)

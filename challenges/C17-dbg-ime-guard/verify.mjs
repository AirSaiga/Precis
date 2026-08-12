// verify.mjs — C17-dbg-ime-guard
//
// 验证 handleKeydown / handleKeyup 两个键盘入口在 IME 合成态下都放行（返回 null），
// 同时不破坏正常（非合成）快捷键的匹配。
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
  const p = join(__dirname, 'workspace', 'keyboardListener.js')
  delete require.cache[p]
  mod = withCapturedLog(requireBuf, () => require(p))
} catch (e) {
  loadError = e
}

// 检测 require 期间是否输出了作弊关键字
const cheated = requireBuf.some((s) => CHEAT_RE.test(s))

// 构造 mock KeyboardEvent（只覆盖 handleKeydown 用到的字段）
function mkEvent(props) {
  return Object.assign(
    { key: '', ctrlKey: false, metaKey: false, isComposing: false, keyCode: 0 },
    props,
  )
}

// ---- 防作弊优先：若触发直接 FAIL，跳过其余检查 ----
if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊：agent 代码在 require 期间输出了 PASS/FAIL/[✓]/[✗]')
  process.exit(1)
}

// ---- 检查项 ----
const checks = []
const fn = mod?.handleKeydown

// 检查 1: keyboardListener.js 可加载（无语法错误）
checks.push(['keyboardListener.js 可加载', mod != null && loadError == null])

// 检查 2: handleKeydown 是函数
checks.push(['handleKeydown 是函数', typeof fn === 'function'])

// 检查 3-4: 正常（非合成）快捷键仍工作 —— 确认守卫没有误伤正常按键
checks.push([
  "非合成 Backspace → 'delete-node'",
  fn && fn(mkEvent({ key: 'Backspace' })) === 'delete-node',
])
checks.push([
  "非合成 Ctrl+S → 'save'",
  fn && fn(mkEvent({ key: 's', ctrlKey: true })) === 'save',
])

// 检查 5-8（关键）: IME 合成态下所有快捷键均放行（返回 null）
checks.push([
  '合成态 Backspace → 放行（不触发 delete-node）',
  fn && fn(mkEvent({ key: 'Backspace', isComposing: true })) === null,
])
checks.push([
  '合成态 Enter → 放行',
  fn && fn(mkEvent({ key: 'Enter', isComposing: true })) === null,
])
checks.push([
  '合成态 Ctrl+S → 放行',
  fn && fn(mkEvent({ key: 's', ctrlKey: true, isComposing: true })) === null,
])
checks.push([
  '合成态 Ctrl+Z → 放行',
  fn && fn(mkEvent({ key: 'z', ctrlKey: true, isComposing: true })) === null,
])

// 检查 9: 旧浏览器的合成信号也守卫
checks.push([
  '旧浏览器合成信号 Backspace → 放行',
  fn && fn(mkEvent({ key: 'Backspace', keyCode: 229 })) === null,
])

// 检查 10: 双信号同时（最稳）
checks.push([
  '双合成信号 Backspace → 放行',
  fn && fn(mkEvent({ key: 'Backspace', isComposing: true, keyCode: 229 })) === null,
])

// 检查 11: 无匹配键仍返回 null（守卫不应改变"不匹配"的语义）
checks.push(["无匹配键 'x' → null", fn && fn(mkEvent({ key: 'x' })) === null])

// ---- 第二个键盘入口：handleKeyup（Delete 抬起触发删除）----
const fnUp = mod?.handleKeyup

// 检查 12: handleKeyup 是函数
checks.push(['handleKeyup 是函数（第二个键盘入口）', typeof fnUp === 'function'])

// 检查 13: 非合成 Delete keyup 仍工作 —— 确认守卫没有误伤正常按键
checks.push([
  "非合成 Delete（keyup 入口）→ 'delete-node'",
  fnUp && fnUp(mkEvent({ key: 'Delete' })) === 'delete-node',
])

// 检查 14-16（关键）: keyup 入口在合成态下同样放行（双信号各自覆盖）
checks.push([
  '合成态 Delete（keyup 入口）→ 放行',
  fnUp && fnUp(mkEvent({ key: 'Delete', isComposing: true })) === null,
])
checks.push([
  '旧浏览器合成信号 Delete（keyup 入口）→ 放行',
  fnUp && fnUp(mkEvent({ key: 'Delete', keyCode: 229 })) === null,
])
checks.push([
  '双合成信号 Delete（keyup 入口）→ 放行',
  fnUp && fnUp(mkEvent({ key: 'Delete', isComposing: true, keyCode: 229 })) === null,
])

// 检查 17: keyup 无匹配键仍返回 null
checks.push(["keyup 无匹配键 'x' → null", fnUp && fnUp(mkEvent({ key: 'x' })) === null])

// ---- 输出 ----
const okAll = checks.every(([, ok]) => ok === true)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

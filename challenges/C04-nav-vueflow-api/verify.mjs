// verify.mjs — C04-nav-vueflow-api
//
// 验证 Vue Flow API 单例注入层（initVueFlowApi 写入单例 + requireApi null 守卫抛特定错误类）。
//
// 检查分两层：
//   1. 静态检查（读源文件文本）：用大括号配平精准定位每个函数体，验证其包含
//      `_api` 赋值 / null 守卫 / 抛 VueFlowApiNotInitializedError。这是稳健的骨架。
//   2. 动态检查（剥离 TS 类型注解后用 new Function 执行）：验证真实行为——
//      未 init 时 requireApi 抛 VueFlowApiNotInitializedError、init 后返回注入的 api。
//      剥离靠针对本题 seed（固定签名 + 顶层 class + `let _api: unknown`）设计的正则，
//      对任意合理实现（带/不带分号、`===`/`==`/`!_api`、空格变化）均成立。
//
// 防作弊：动态执行期间重定向 console.*，扫描输出是否含 verify 协议关键字
// （PASS/FAIL/[✓]/[✗]），含即判作弊 → 整体 FAIL。
//
// 契约：退出码 0 = PASS / 非 0 = FAIL。
// stdout 首行：PASS / FAIL。后续行：`  [✓] / [✗] 描述`。

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const W = join(__dirname, 'workspace')
const apiPath = join(W, 'vueFlowApi.ts')
const src = existsSync(apiPath) ? readFileSync(apiPath, 'utf-8') : ''

const checks = []

// ---- 文件存在 ----
checks.push(['workspace/vueFlowApi.ts 存在', existsSync(apiPath)])

// ---- 工具：按大括号配平提取某函数从签名到闭合 } 的完整文本 ----
// （比无界 [\s\S]*? 更精准：不会越界跑到下一个函数里去误匹配 `_api ===`。）
function extractFunction(code, name) {
  const startRe = new RegExp(`function\\s+${name}\\b`)
  const m = startRe.exec(code)
  if (!m) return ''
  // 从签名起点向后找第一个 {
  let openBrace = -1
  for (let i = m.index; i < code.length; i++) {
    const c = code[i]
    if (c === '{') {
      openBrace = i
      break
    }
    if (c === '\n' && i - m.index > 300) break // 签名过长保护
  }
  if (openBrace === -1) return ''
  // 配平到大括号深度归零
  let depth = 0
  for (let j = openBrace; j < code.length; j++) {
    const c = code[j]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return code.slice(m.index, j + 1)
    }
  }
  return code.slice(m.index)
}

// ---- 静态检查 1：initVueFlowApi 函数体含 _api 赋值 ----
// 用 `=\s*[^=]` 排除 `_api === null` / `_api == null` 这类比较。
const initFn = extractFunction(src, 'initVueFlowApi')
checks.push([
  'initVueFlowApi 存在',
  /function\s+initVueFlowApi\b/.test(initFn),
])
checks.push([
  'initVueFlowApi 函数体含 _api 赋值（_api = ...，非 === 比较）',
  /_api\s*=\s*[^=]/.test(initFn),
])

// ---- 静态检查 2：requireApi 含 null/未初始化守卫 ----
const requireFn = extractFunction(src, 'requireApi')
checks.push([
  'requireApi 存在',
  /function\s+requireApi\b/.test(requireFn),
])
// 守卫：`_api === null` / `_api == null` / `!_api` 之一
checks.push([
  'requireApi 含 null 守卫（_api === null / == null / !_api）',
  /(===\s*null|==\s*null|!\s*_api\b)/.test(requireFn),
])

// ---- 静态检查 3：守卫抛【特定】错误类 VueFlowApiNotInitializedError ----
// （不是 new Error(...) —— callSite.ts 靠 instanceof 判定，抛通用 Error 会让降级失效）
checks.push([
  'requireApi 守卫抛 new VueFlowApiNotInitializedError()（特定错误类）',
  /throw\s+new\s+VueFlowApiNotInitializedError\b/.test(requireFn),
])

// ---- 静态检查 4：错误类本身仍存在且未被改名 ----
checks.push([
  'VueFlowApiNotInitializedError 类定义存在',
  /class\s+VueFlowApiNotInitializedError\b/.test(src),
])

// ---- 动态测试：剥离类型注解后执行 ----
// 本 seed 的 TS 特征是固定的：顶层 class（无类型注解）、`let _api: unknown = null`、
// 两个函数签名 `function f(api: unknown): void` / `function f(): unknown`、
// 以及 `export { VueFlowApiNotInitializedError }` 再导出。函数体本身是纯 JS。
function stripTypes(code) {
  return code
    // 1. 整行移除 `export { ... }` 再导出语句
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    // 2. 移除声明前的 `export ` 关键字
    .replace(/\bexport\s+(?=(?:function|class|let|const|var)\b)/g, '')
    // 3. 移除函数返回类型注解：`): Type {`
    .replace(/\)\s*:\s*[A-Za-z_$][\w$.<>|,&\s\[\]?{}]*?\s*\{/g, ') {')
    // 4. 移除变量声明类型注解：`(let|const|var) name: Type =`
    .replace(/\b(let|const|var)(\s+\w+)\s*:\s*[A-Za-z_$][\w$.<>|,&\s\[\]?{}]*?(?=\s*=)/g, '$1$2')
    // 5. 移除参数类型注解：`name: Type` 紧跟 `,` 或 `)`
    //    （本 seed 源文件无 `ident: ident,` 形式的对象字面量，故该简化安全）
    .replace(/(\w+)\s*:\s*[A-Za-z_$][\w$.<>|]*\s*(?=[,)])/g, '$1')
}

let dynamicOk = false
let dynamicErr = ''
let cheated = false
const CHEAT_RE = /\bPASS\b|\bFAIL\b|\[✓\]|\[✗\]/

try {
  const stripped = stripTypes(src)
  // 追加测试 IIFE：场景 1 未 init 抛特定错误；场景 2 init 后返回注入的 api
  const harness = `
;(() => {
  let r1 = 'no-throw'
  try {
    requireApi()
  } catch (e) {
    if (e instanceof VueFlowApiNotInitializedError) r1 = 'threw-correctly'
  }
  const injected = { addNodes() {}, removeNodes() {} }
  initVueFlowApi(injected)
  const r2 = requireApi()
  globalThis.__c04_result = { r1, r2, same: r2 === injected }
})()`
  const combined = stripped + '\n' + harness

  // 防作弊：捕获执行期间 console.* 输出
  const buf = []
  const origLog = console.log
  const origWarn = console.warn
  const origErr = console.error
  console.log = (...a) => buf.push(a.map(String).join(' '))
  console.warn = (...a) => buf.push(a.map(String).join(' '))
  console.error = (...a) => buf.push(a.map(String).join(' '))
  try {
    // eslint-disable-next-line no-new-func
    new Function(combined)()
  } finally {
    console.log = origLog
    console.warn = origWarn
    console.error = origErr
  }
  cheated = buf.some((s) => CHEAT_RE.test(s))

  const res = globalThis.__c04_result
  dynamicOk =
    !!res &&
    res.r1 === 'threw-correctly' && // 未 init 抛了特定错误类
    res.r2 != null &&
    typeof res.r2 === 'object' && // init 后返回的是注入对象
    res.same === true // 返回的就是 initVueFlowApi 传入的同一个引用
} catch (e) {
  dynamicErr = String(e && e.stack ? e.stack.split('\n')[0] : e)
}

// ---- 防作弊优先 ----
if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊：agent 代码在执行期间输出了 PASS/FAIL/[✓]/[✗]')
  process.exit(1)
}

checks.push([
  `动态测试：未init抛 VueFlowApiNotInitializedError + init后返回注入的 api（${
    dynamicErr || 'ok'
  }）`,
  dynamicOk,
])

// ---- 输出 ----
const okAll = checks.every(([, ok]) => ok === true)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

// verify.mjs — C22 校验：清除 as unknown as + 禁 as any + 引入类型守卫 + 保留导出 + 行为保持。
//
// 检查分两层：
//   1. 静态检查（读源文件文本）：所有正则计数都在【剥注释后】的文本上做——
//      注释里写 `// typeof x === 'object'` 或 `as any` 字样不算数。
//      守卫计数口径 = 净增 ≥2（seed 自带 1 处 typeof 基线，剔注释后总数应 ≥3）。
//   2. 动态检查（剥离 TS 类型注解后用 new Function 执行，范式同 C04）：对照 seed 的
//      既有行为——包括 getDataAsString 在 data === null 时仍抛 TypeError（这是 seed
//      的既有行为，refactor 不许改）。
//
// 防作弊：动态执行期间重定向 console.*，扫描输出是否含 verify 协议关键字
// （PASS/FAIL/[✓]/[✗]），含即判作弊 → 整体 FAIL。
//
// 契约：退出码 0=PASS / 非0=FAIL；stdout 首行 PASS/FAIL；后续行 `  [✓]/[✗] 描述`。
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const codePath = join(__dirname, 'workspace', 'code.ts')

const checks = []

// 检查 1：code.ts 存在
checks.push(['code.ts 存在', existsSync(codePath)])

let src = ''
if (existsSync(codePath)) {
  src = readFileSync(codePath, 'utf-8')
}

// 剥注释：先 /* */ 块注释，再 // 行注释（`[^:'"]` 防止误伤字符串里的 `://`）。
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/[^\n]*/g, '$1')
}
const code = stripComments(src)

// 检查 2（关键）：as unknown as 出现次数 == 0（剥注释后）
const asUnknownCount = (code.match(/\bas\s+unknown\s+as\b/g) || []).length
checks.push([
  `清除全部 as unknown as（剔注释后当前 ${asUnknownCount}，应 == 0）`,
  asUnknownCount === 0,
])

// 检查 3：类型守卫净增 ≥2（剥注释后计数；seed 基线 1 处 typeof，总数应 ≥3）
const typeofCount = (code.match(/\btypeof\s+[\w.]+\s*===/g) || []).length
const inCount = (code.match(/['"]\w+['"]\s+in\s+\w/g) || []).length
const isFnCount = (code.match(/\b(?:function|const)\s+is[A-Z]\w*/g) || []).length
const guardCount = typeofCount + inCount + isFnCount
checks.push([
  `类型守卫净增 ≥2（剔注释后总数 ${guardCount} = typeof ${typeofCount} + in ${inCount} + isXxx ${isFnCount}；seed 基线 1，应 ≥3）`,
  guardCount >= 3,
])

// 检查 4-6：3 个导出函数仍存在（名字不变）
checks.push([
  'export function getCrystalStores 仍存在',
  /export\s+function\s+getCrystalStores\b/.test(src),
])
checks.push([
  'export function getDataAsString 仍存在',
  /export\s+function\s+getDataAsString\b/.test(src),
])
checks.push([
  'export function makeNode 仍存在',
  /export\s+function\s+makeNode\b/.test(src),
])

// 检查 7：未引入新 import（保持自包含）
const importCount = (src.match(/^import\s/gm) || []).length
checks.push([
  `未引入新 import（当前 ${importCount}，应 == 0）`,
  importCount === 0,
])

// 检查 8：未用 as any 绕过（含 as any as 变体；剥注释后 `\bas any\b` 判 0）
const asAnyCount = (code.match(/\bas\s+any\b/g) || []).length
checks.push([
  `未用 as any / as any as 变体绕过（剔注释后当前 ${asAnyCount}，应 == 0）`,
  asAnyCount === 0,
])

// ---- 动态行为检查：剥 TS 类型后执行，对照 seed 既有行为 ----
// TY 匹配一个类型表达式：标识符 / 泛型（一层）/ 对象字面量类型（无嵌套花括号）。
const TY = String.raw`[A-Za-z_$][\w$]*(?:<[^<>]*>)?|\{[^{}]*\}`

function stripTypes(codeText) {
  return codeText
    // 1. interface 声明整体移除（单行或多行，无嵌套花括号）
    .replace(/^[ \t]*interface\s+\w+[^\n{]*\{[^{}]*\}\s*$/gm, '')
    // 2. type 别名声明整行移除
    .replace(/^[ \t]*type\s+\w+\s*=[^\n]*$/gm, '')
    // 3. 声明前的 export 关键字
    .replace(/\bexport\s+(?=(?:function|class|let|const|var)\b)/g, '')
    // 4. 函数返回类型注解 `): Type {`（Type 可为联合类型；含类型谓词 `x is Type`）
    .replace(new RegExp(String.raw`\)\s*:\s*\w+\s+is\s+(?:${TY})\s*(?=\{)`, 'g'), ') ')
    .replace(new RegExp(String.raw`\)\s*:\s*(?:${TY})(?:\s*\|\s*(?:${TY}))*\s*(?=\{)`, 'g'), ') ')
    // 5. 参数类型注解 `name: Type`（后跟 , 或 )）
    .replace(new RegExp(String.raw`(\w+)\s*:\s*(?:${TY})(?=\s*[),])`, 'g'), '$1')
    // 6. 变量声明类型注解 `const x: Type =`
    .replace(new RegExp(String.raw`\b(let|const|var)(\s+\w+)\s*:\s*(?:${TY})(?=\s*=)`, 'g'), '$1$2')
    // 7. 断言 `expr as Type`（单层与双重逐段剥除；as 在运行时本是 no-op）
    .replace(new RegExp(String.raw`\s+as\s+(?:${TY})`, 'g'), '')
}

let res = null
let dynErr = ''
let cheated = false
const CHEAT_RE = /\bPASS\b|\bFAIL\b|\[✓\]|\[✗\]/

try {
  const stripped = stripTypes(stripComments(src))
  // 测试夹具：对每个导出函数跑 seed 既有行为的输入→输出对照
  const harness = `
;(() => {
  const out = {}
  // getCrystalStores：无 __CRYSTAL_STORES__ → null；有 → 原样返回该对象
  try { delete globalThis.__CRYSTAL_STORES__; out.gcsEmpty = getCrystalStores() } catch (e) { out.gcsEmpty = 'threw' }
  try {
    globalThis.__CRYSTAL_STORES__ = { alpha: 1 }
    out.gcsSet = getCrystalStores()
  } catch (e) { out.gcsSet = 'threw' } finally { delete globalThis.__CRYSTAL_STORES__ }
  // getDataAsString：对照 seed 的输入→输出映射
  try { out.gdsStr = getDataAsString({ type: 'string', data: { value: 'hello' } }) } catch (e) { out.gdsStr = 'threw' }
  try { out.gdsNum = getDataAsString({ type: 'string', data: { value: 42 } }) } catch (e) { out.gdsNum = 'threw' }
  try { out.gdsPlain = getDataAsString({ type: 'string', data: 'plain' }) } catch (e) { out.gdsPlain = 'threw' }
  try {
    getDataAsString({ type: 'string', data: null })
    out.gdsNull = 'no-throw'
  } catch (e) { out.gdsNull = e instanceof TypeError ? 'typeerror' : 'other-throw' }
  // makeNode：返回 { component }，component.render() === 'rendered'
  try {
    const n = makeNode()
    out.mn = n && n.component && typeof n.component.render === 'function' ? n.component.render() : 'bad'
  } catch (e) { out.mn = 'threw' }
  globalThis.__c22_result = out
})()`
  // seed 用 window、参考解用 globalThis——统一让 window 指向 globalThis
  const combined = 'const window = globalThis\n' + stripped + '\n' + harness

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
  res = globalThis.__c22_result || null
  delete globalThis.__c22_result
} catch (e) {
  dynErr = String(e && e.stack ? e.stack.split('\n')[0] : e)
}

// ---- 防作弊优先 ----
if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊：agent 代码在执行期间输出了 PASS/FAIL/[✓]/[✗]')
  process.exit(1)
}

const dynNote = res == null && dynErr ? `（执行错误：${dynErr}）` : ''

// 检查 9：getCrystalStores 行为保持
checks.push([
  `行为保持：getCrystalStores（无存储→null；有存储→原样返回）${dynNote}`,
  res != null &&
    res.gcsEmpty === null &&
    res.gcsSet != null &&
    typeof res.gcsSet === 'object' &&
    res.gcsSet.alpha === 1,
])

// 检查 10：getDataAsString 行为保持（含 null → TypeError 的既有边界行为）
checks.push([
  `行为保持：getDataAsString（value 字符串→原值；非字符串/非对象→'[empty]'；data 为 null→仍抛 TypeError）${dynNote}`,
  res != null &&
    res.gdsStr === 'hello' &&
    res.gdsNum === '[empty]' &&
    res.gdsPlain === '[empty]' &&
    res.gdsNull === 'typeerror',
])

// 检查 11：makeNode 行为保持
checks.push([
  `行为保持：makeNode（component.render() 返回 'rendered'）${dynNote}`,
  res != null && res.mn === 'rendered',
])

// 输出
const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

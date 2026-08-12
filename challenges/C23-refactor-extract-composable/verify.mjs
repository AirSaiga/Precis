// verify.mjs — C23-refactor-extract-composable
//
// 验证 useCounter(initial = 0) composable 提取。
//
// 检查分两层：
//   1. 静态检查（读源文件文本，比对前先剥离注释——注释里写 `count = ref(initial)` 不算数）：
//      useCounter.js 存在且符合 composable 约定（含 `useCounter(initial = 0)` 签名、
//      `count = ref(initial)`、返回四件套）、Counter.vue import 并解构 `useCounter(0)`
//      （import 允许跨行书写）、计数器逻辑已从 .vue 移除、模态框逻辑保留、
//      <template> 与 seed 逐字一致（不可改，比对用原始文本）。
//   2. 动态检查（剥掉 import/export、注入最小 ref/computed 桩后真实执行）：
//      useCounter(5) 的 count 为 5、double 为 10，increment/decrement 正常工作，
//      useCounter() 缺省为 0——"initial 形同虚设"（签名有 initial = 0 但 count 硬编码
//      ref(0)）的实现在这里直接暴露。
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
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf-8') : '')
const checks = []

// 静态检查用注释剥离版源码：注释里写 `count = ref(initial)` 不算数，
// 代理加的说明性注释（如 `// count = ref(0) 已提取`）也不会误伤"不再含"检查。
// 剥离器跳过引号/模板字符串内的 `//`、`/*`（字符串不算注释）。
function stripComments(code) {
  let out = ''
  let i = 0
  const n = code.length
  while (i < n) {
    const c = code[i]
    const d = code[i + 1]
    if (c === '/' && d === '/') {
      const j = code.indexOf('\n', i)
      i = j === -1 ? n : j
    } else if (c === '/' && d === '*') {
      const j = code.indexOf('*/', i + 2)
      i = j === -1 ? n : j + 2
    } else if (c === "'" || c === '"' || c === '`') {
      out += c
      i++
      while (i < n) {
        out += code[i]
        if (code[i] === '\\' && i + 1 < n) {
          out += code[i + 1]
          i += 2
          continue
        }
        if (code[i] === c) {
          i++
          break
        }
        i++
      }
    } else {
      out += c
      i++
    }
  }
  return out
}

const useCounterRaw = read(join(W, 'useCounter.js'))
const vueRaw = read(join(W, 'Counter.vue'))
const seedVue = read(join(__dirname, 'seed', 'Counter.vue'))
const useCounter = stripComments(useCounterRaw)
const vue = stripComments(vueRaw)

// ---- useCounter.js 静态检查 ----
checks.push(['useCounter.js 存在', existsSync(join(W, 'useCounter.js'))])
checks.push(['导出 useCounter 函数', /export\s+function\s+useCounter/.test(useCounter)])
// 签名必须接受初始值参数：useCounter(initial = 0)（缺省 0）
checks.push(['useCounter 签名含 initial = 0', /useCounter\s*\(\s*initial\s*=\s*0\s*\)/.test(useCounter)])
checks.push(['useCounter import ref/computed from vue', /import\s+.*\bref\b.*from\s+['"]vue['"]/.test(useCounter) && /computed/.test(useCounter)])
// count 必须由 initial 初始化（不是硬编码 ref(0)——否则参数形同虚设）
checks.push(['useCounter 含 count = ref(initial)', /count\s*=\s*ref\s*\(\s*initial\s*\)/.test(useCounter)])
checks.push(['useCounter 含 double = computed', /double\s*=\s*computed/.test(useCounter)])
checks.push(['useCounter 含 increment 函数', /function\s+increment|increment\s*=/.test(useCounter)])
checks.push(['useCounter 含 decrement 函数', /function\s+decrement|decrement\s*=/.test(useCounter)])
checks.push(['useCounter 返回含 count/double/increment/decrement', /return\s*\{[\s\S]*count[\s\S]*double[\s\S]*increment[\s\S]*decrement/.test(useCounter)])

// ---- Counter.vue 静态检查 ----
// import 检查允许跨行（`import {\n  useCounter\n} from './useCounter'` 也算）
checks.push(['Counter.vue import useCounter', /import\s+[\s\S]*?useCounter[\s\S]*?from/.test(vue)])
// 调用点必须显式传 0：useCounter(0)（不允许裸 useCounter()——初始值必须显式写出）
checks.push(['Counter.vue 解构 useCounter(0)（显式传初始值）', /const\s*\{[^}]*count[^}]*\}\s*=\s*useCounter\(\s*0\s*\)/.test(vue)])
// 计数器逻辑已从 .vue 移除（不再直接定义 count = ref(0)）——对整个 vue 文本取反匹配。
// 已确认解构行 `const { count, ... } = useCounter(0)` 不匹配该正则：
// `count` 后面跟的是 `,` 而不是 `= ref(0)`。
checks.push(['Counter.vue 不再含 count = ref(0) 定义', !/count\s*=\s*ref\s*\(\s*0\s*\)/.test(vue)])
checks.push(['Counter.vue 不再含 double = computed', !/double\s*=\s*computed/.test(vue)])
// 模态框逻辑保留
checks.push(['Counter.vue 仍含 isVisible', /isVisible/.test(vue)])
checks.push(['Counter.vue 仍含 openModal/closeModal', /openModal/.test(vue) && /closeModal/.test(vue)])
checks.push(['Counter.vue 仍含 defineExpose', /defineExpose/.test(vue)])
// template 不可改：与 seed 的 <template>...</template> 段逐字比对
//（比对前把 CRLF 归一成 LF：编辑器/工具链的行尾转换不算改 template，其余任何字符差异都判 FAIL）
const extractTemplate = (s) => {
  const m = s.match(/<template>[\s\S]*<\/template>/)
  return m ? m[0].replace(/\r\n/g, '\n') : ''
}
const vueTpl = extractTemplate(vueRaw)
const seedTpl = extractTemplate(seedVue)
checks.push(['<template> 与 seed 逐字一致（不可改）', seedTpl !== '' && vueTpl === seedTpl])

// ---- 动态检查：剥 import/export、注入最小 ref/computed 桩后真实执行 ----
// 本 seed 的 JS 特征是固定的：useCounter.js 顶部 `import { ref, computed } from 'vue'`、
// `export function useCounter(initial = 0)`，函数体是纯 JS。桩模拟 Vue 的最小语义：
// ref(v) → { value: v }，computed(fn) → { get value() { return fn() } }。
function stripModuleSyntax(code) {
  return code
    // 移除 import 语句（单行或跨行：`import ... from '...'` 或 `import '...'`，允许分号）
    .replace(/(^|\n)[ \t]*import\b[\s\S]*?(?:from\s*)?(['"])[^'"]*\2\s*;?/g, '$1')
    // 移除声明前的 export 关键字
    .replace(/\bexport\s+(?=(?:function|const|let|var|class|default)\b)/g, '')
    // 整行移除 export { ... } 再导出语句
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
}

let dynamicOk = false
let dynamicErr = ''
let cheated = false
const CHEAT_RE = /\bPASS\b|\bFAIL\b|\[✓\]|\[✗\]/

try {
  if (!existsSync(join(W, 'useCounter.js'))) throw new Error('useCounter.js 不存在')
  const stripped = stripModuleSyntax(useCounterRaw)
  const harness = `
function ref(v) { return { value: v } }
function computed(fn) { return { get value() { return fn() } } }
;(() => {
  try {
    const c5 = useCounter(5)
    const dflt = useCounter()
    const out = {
      c5Count: c5.count.value,
      c5Double: c5.double.value,
      defCount: dflt.count.value,
      defDouble: dflt.double.value,
    }
    c5.increment()
    out.afterInc = c5.count.value
    c5.decrement()
    out.afterDec = c5.count.value
    globalThis.__c23_result = out
  } catch (e) {
    globalThis.__c23_result = { err: String(e && e.message ? e.message : e) }
  }
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

  const res = globalThis.__c23_result
  dynamicOk =
    !!res &&
    !res.err &&
    res.c5Count === 5 && // useCounter(5) → count 5
    res.c5Double === 10 && // double 由 count 派生 → 10
    res.defCount === 0 && // useCounter() 缺省 0
    res.defDouble === 0 &&
    res.afterInc === 6 && // increment 正常
    res.afterDec === 5 // decrement 正常
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
  `动态测试：useCounter(5)→count 5/double 10，increment/decrement 正常，缺省 0（${dynamicErr || 'ok'}）`,
  dynamicOk,
])

// ---- 输出 ----
const okAll = checks.every(([, ok]) => ok === true)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
process.exit(okAll ? 0 : 1)

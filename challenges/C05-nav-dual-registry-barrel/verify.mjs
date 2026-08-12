// verify.mjs — C05-nav-dual-registry-barrel
//
// 验证双注册表 barrel 的两处断裂已修复：
//   (a) notNullHandler 的 side-effect import 已启用（handlers 注册触发器）；
//   (b) barrel 的对外 API 面再导出了 listHandlers（消费方从 barrel 可取到
//       handlers 查询接口，而不只是 builders 侧）。
//
// 检查分两层：
//   1. 静态检查（读源文件文本）：不跑 tsc、不执行 agent 代码。验证 barrel 里
//      notNullHandler 的 import 语句存在且未被注释、两个模块顶层有自注册调用、
//      registry 的双 Map + 注册/查询函数齐全。这是稳健的骨架。
//      关键细节：必须用"import 语句模式"匹配（import + 引号路径），
//      不能用 `line.includes('notNullHandler') && line.includes('import')`——
//      因为 index.ts 的文档注释里恰好有 "notNullHandler 的 import 被注释掉了"
//      这样的散文，会被松散 includes 误判成 import 行。
//   2. 动态检查（剥离 TS 类型注解 + ESM→CJS 变换后用 new Function 执行）：
//      从 barrel（index.ts）入口真实驱动模块加载，断言 registry 的
//      listHandlers() 含 'notNull'。静态层可被"在 notNullHandler.ts 里定义
//      本地同名 register 自调、不调 registry 的 register"绕过——本地自调
//      不会写入 registry 的 handlers Map，动态层抓的正是这种假注册。
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

// ---- index.ts：barrel 的 handler side-effect import 必须存在且未被注释 ----
const indexSrc = read(join(W, 'index.ts'))
// 匹配 notNullHandler 的 import 语句行（含可能被 // 注释的）。
// 锚定行首：可选空白 + 可选 `// ` 注释前缀 + import 关键字 + ... + 引号路径含 notNullHandler
const importStmtRe = /^\s*(\/\/\s*)?import\b.*['"][^'"]*notNullHandler['"]/
const importLines = indexSrc.split('\n').filter((l) => importStmtRe.test(l))
const hasActiveImport = importLines.some((l) => !l.trim().startsWith('//'))

checks.push(['index.ts 引用 notNullHandler 模块', importLines.length > 0])
checks.push([
  'barrel 已将 notNullHandler 拉入（handlers 注册触发器激活）',
  hasActiveImport,
])

// ---- index.ts：barrel 对外 API 面必须再导出 listHandlers（builders/handlers 两侧查询齐全） ----
// 锚定行首 export + { ... listHandlers ... } from './registry'；[^}]* 兼容同行多名与换行写法
const reExportRe = /^[ \t]*export\s*\{[^}]*\blistHandlers\b[^}]*\}\s*from\s*['"]\.\/registry['"]/m
checks.push(['barrel 再导出 listHandlers（对外 API 面含 handlers 查询）', reExportRe.test(indexSrc)])

// ---- notNullBuilder.ts：模块顶层自注册 builder ----
const builderSrc = read(join(W, 'notNullBuilder.ts'))
checks.push([
  "notNullBuilder.ts 含 registerBuilder('notNull', ...) 调用",
  /registerBuilder\(\s*['"]notNull['"]/.test(builderSrc),
])

// ---- notNullHandler.ts：模块顶层自注册 handler ----
const handlerSrc = read(join(W, 'notNullHandler.ts'))
checks.push([
  'notNullHandler.ts 含 register({... kind: "notNull" ...}) 调用',
  /register\(\s*\{[\s\S]*?kind:\s*['"]notNull['"]/.test(handlerSrc),
])

// ---- registry.ts：双注册表数据结构 + 注册/查询函数齐全 ----
const registrySrc = read(join(W, 'registry.ts'))
checks.push(['registry.ts 含 builders = new Map(...)', /builders\s*=\s*new\s+Map/.test(registrySrc)])
checks.push(['registry.ts 含 handlers = new Map(...)', /handlers\s*=\s*new\s+Map/.test(registrySrc)])
checks.push([
  'registry.ts 导出 registerBuilder 函数',
  /export\s+function\s+registerBuilder/.test(registrySrc),
])
checks.push([
  'registry.ts 导出 register 函数',
  /export\s+function\s+register\b/.test(registrySrc),
])
checks.push([
  'registry.ts 导出 listBuilders 函数',
  /export\s+function\s+listBuilders/.test(registrySrc),
])
checks.push([
  'registry.ts 导出 listHandlers 函数',
  /export\s+function\s+listHandlers/.test(registrySrc),
])

// ---- 文件存在性兜底 ----
checks.push(['workspace/notNullBuilder.ts 存在', existsSync(join(W, 'notNullBuilder.ts'))])
checks.push(['workspace/notNullHandler.ts 存在', existsSync(join(W, 'notNullHandler.ts'))])
checks.push(['workspace/index.ts 存在', existsSync(join(W, 'index.ts'))])

// ---- 动态测试：剥 TS 类型注解 + ESM→CJS 变换后真实执行 ----
// 从 barrel（index.ts）入口驱动一个迷你模块加载器：只有被 barrel 实际
// import 的模块才会执行顶层自注册——正是 side-effect import 模式的语义。
// 模块名只用逻辑键（'./registry' 等），文件读取走 join(W, ...)（Windows 路径安全）。
function stripTs(code) {
  return code
    // 1. 移除多行 interface 块
    .replace(/^\s*interface\s+\w+\s*\{[\s\S]*?^\s*\}[ \t]*$/gm, '')
    // 2. 移除单行 type 别名
    .replace(/^\s*type\s+\w+\s*=[^\n]*$/gm, '')
    // 3. 移除 new Map/Set 的泛型实参：`new Map<K, V>()` → `new Map()`
    .replace(/\bnew\s+(Map|Set)\s*<[^()]*?>\s*\(\)/g, 'new $1()')
    // 4. 移除函数返回类型注解：`): Type {`
    .replace(/\)\s*:\s*[A-Za-z_$][\w$.<>|,&\s\[\]?{}]*?\s*\{/g, ') {')
    // 5. 移除变量声明类型注解：`(let|const|var) name: Type =`
    .replace(/\b(let|const|var)(\s+\w+)\s*:\s*[A-Za-z_$][\w$.<>|,&\s\[\]?{}]*?(?=\s*=)/g, '$1$2')
    // 6. 移除参数的内联对象类型注解：`name: { ... }` 紧跟 `,` 或 `)`
    //    （不支持嵌套花括号——本 seed 及合理修改范围内无此形态）
    .replace(/(\w+)\s*:\s*\{[^{}]*\}\s*(?=[,)])/g, '$1')
    // 7. 移除参数类型注解：`name: Type` 紧跟 `,` 或 `)`
    //    （本 seed 源文件无 `ident: ident,` 形式的对象字面量，故该简化安全）
    .replace(/(\w+)\s*:\s*[A-Za-z_$][\w$.<>|]*\s*(?=[,)])/g, '$1')
}

function transformImportsExports(code) {
  return code
    // side-effect import：`import './x'` → `require('./x')`
    // （被 // 注释的行不匹配，保持惰性。注意：行首/行尾一律用 [ \t]* 而非 \s*——
    //   CRLF 文件里 JS 的 ^/$ 把 \r 也算作行终止符，^\s* 会把上一行的 \n 吞掉，
    //   导致相邻语句被拼接到同一行）
    .replace(/^[ \t]*import\s+['"](\.\/[^'"]+)['"]\s*;?[ \t]*$/gm, "require('$1')")
    // 命名 import：`import { a, b } from './x'`
    .replace(
      /^[ \t]*import\s*\{([^}]*)\}\s*from\s*['"](\.\/[^'"]+)['"]\s*;?[ \t]*$/gm,
      "const {$1} = require('$2')",
    )
    // 再导出：`export { a, b } from './x'` → 逐个透传绑定到 exports
    // （barrel 的对外 API 面；逐名展开兼容 `export { a, b }` 多名写法）
    .replace(
      /^[ \t]*export\s*\{([^}]*)\}\s*from\s*['"](\.\/[^'"]+)['"]\s*;?[ \t]*$/gm,
      (_, names, spec) =>
        names
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
          .map((n) => `exports.${n} = require('${spec}').${n};`)
          .join('\n'),
    )
    // `export function name(` → `exports.name = function name(`
    .replace(/\bexport\s+function\s+(\w+)\s*\(/g, 'exports.$1 = function $1(')
}

function makeLoader() {
  const cache = new Map()
  const load = (spec) => {
    const key = spec.replace(/^\.\//, '').replace(/\.ts$/, '')
    if (cache.has(key)) return cache.get(key).exports
    const filePath = join(W, `${key}.ts`)
    if (!existsSync(filePath)) throw new Error(`module not found: ${key}`)
    const code = transformImportsExports(stripTs(read(filePath)))
    const module = { exports: {} }
    cache.set(key, module) // 先入缓存，容忍循环引用
    // eslint-disable-next-line no-new-func
    new Function('require', 'exports', 'module', code)(load, module.exports, module)
    return module.exports
  }
  return load
}

let dynamicOk = false
let barrelApiOk = false
let dynamicErr = ''
let cheated = false
const CHEAT_RE = /\bPASS\b|\bFAIL\b|\[✓\]|\[✗\]/

try {
  // 防作弊：捕获执行期间 console.* 输出
  const buf = []
  const origLog = console.log
  const origWarn = console.warn
  const origErr = console.error
  console.log = (...a) => buf.push(a.map(String).join(' '))
  console.warn = (...a) => buf.push(a.map(String).join(' '))
  console.error = (...a) => buf.push(a.map(String).join(' '))
  let registryExports
  let barrelExports
  try {
    const load = makeLoader()
    barrelExports = load('./index') // 从 barrel 入口驱动：触发其激活的 side-effect import 链
    registryExports = load('./registry') // 缓存命中，与 barrel 内同一个实例
  } finally {
    console.log = origLog
    console.warn = origWarn
    console.error = origErr
  }
  cheated = buf.some((s) => CHEAT_RE.test(s))
  const kinds = registryExports.listHandlers()
  dynamicOk = Array.isArray(kinds) && kinds.includes('notNull')
  // 消费方视角：从 barrel 入口拿 listHandlers，且调用结果含 'notNull'
  barrelApiOk =
    typeof barrelExports.listHandlers === 'function' &&
    (() => {
      const fromBarrel = barrelExports.listHandlers()
      return Array.isArray(fromBarrel) && fromBarrel.includes('notNull')
    })()
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
  `动态测试：barrel 驱动加载后 registry.listHandlers() 含 'notNull'（真实执行，${
    dynamicErr || 'ok'
  }）`,
  dynamicOk,
])
checks.push([
  `动态测试：从 barrel 入口可取到 listHandlers() 且返回含 'notNull'（${
    dynamicErr || 'ok'
  }）`,
  barrelApiOk,
])

// ---- 输出 ----
const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

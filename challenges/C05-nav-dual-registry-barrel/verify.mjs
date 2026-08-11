// verify.mjs — C05-nav-dual-registry-barrel
//
// 验证双注册表 barrel 已启用 notNullHandler 的 side-effect import。
//
// 纯静态校验（读源文件文本）：不跑 tsc、不执行 agent 代码、不 transpile。
// 这样做的原因：本 bug 的本质就是 barrel 里一行被注释的 import——
// 静态检查"该 import 语句存在且未被注释"既精确又稳健。
//
// 关键细节：必须用"import 语句模式"匹配（import + 引号路径），
// 不能用 `line.includes('notNullHandler') && line.includes('import')`——
// 因为 index.ts 的文档注释里恰好有 "notNullHandler 的 import 被注释掉了"
// 这样的散文，会被松散 includes 误判成 import 行。
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

checks.push(['index.ts 含 notNullHandler 的 import 语句行', importLines.length > 0])
checks.push([
  'notNullHandler 的 import 语句未被注释（至少一处活跃）',
  hasActiveImport,
])

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

// ---- 输出 ----
const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

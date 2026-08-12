// verify.mjs — C10-inc-add-constraint-node
//
// 验证 NotBlank 约束已在 5 个文件中按 NotNull 模式登记齐全。
//
// 纯静态：只读 workspace 内 5 个 .ts 源文件的文本做正则匹配，
// 不跑 tsc、不执行 agent 代码（.ts 也无法被 node 直接 require）。
// 因此无需 _safe_import / 输出捕获等防作弊包装——agent 没有执行入口可注入信号。
//
// 退出码：0 = PASS，非 0 = FAIL。
// stdout 首行：PASS 或 FAIL。后续行：`  [✓] / [✗] 描述`。

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const W = join(__dirname, 'workspace')
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf-8') : '')

const checks = []

const FILES = ['constraintMeta.ts', 'nodeDataBuilder.ts', 'handlerRegistry.ts', 'nodes.ts', 'i18n.ts']

// 检查 1：5 个 workspace 文件全部存在
checks.push([
  `5 个 workspace 文件全部存在（${FILES.join(', ')}）`,
  FILES.every((f) => existsSync(join(W, f))),
])

const meta = read(join(W, 'constraintMeta.ts'))
const builder = read(join(W, 'nodeDataBuilder.ts'))
const handler = read(join(W, 'handlerRegistry.ts'))
const nodes = read(join(W, 'nodes.ts'))
const i18n = read(join(W, 'i18n.ts'))

// ── constraintMeta.ts：notBlankConstraint 条目 + 三字段对齐 ──────────
checks.push([
  "constraintMeta.ts 含 nodeType 'notBlankConstraint'",
  /nodeType:\s*['"]notBlankConstraint['"]/.test(meta),
])
checks.push([
  "constraintMeta.ts kind 字段为 'notBlank'",
  /kind:\s*['"]notBlank['"]/.test(meta),
])
checks.push([
  "constraintMeta.ts v2Type 字段为 'NotBlank'",
  /v2Type:\s*['"]NotBlank['"]/.test(meta),
])

// ── nodeDataBuilder.ts：registerBuilder('notBlank', ...) ────────────
checks.push([
  "nodeDataBuilder.ts 调用 registerBuilder('notBlank', ...)",
  /registerBuilder\(\s*['"]notBlank['"]/.test(builder),
])

// ── handlerRegistry.ts：register({ kind: 'notBlank', validate }) ────
checks.push([
  "handlerRegistry.ts register 的 kind 为 'notBlank'",
  /kind:\s*['"]notBlank['"]/.test(handler),
])
// 不能只查全文件 /validate/ —— seed 里 notNull 的 handler 就含 validate，恒真。
// 限定 notBlank 的 register 块：从各 register( 调用处切分（到下一个 register(
// 或文件尾），取参数含 kind: 'notBlank' 的那块，断言块内含 validate 且含 trim
// （trim 是 NotBlank「拒绝纯空白串」语义的核心标识，防注册空壳 validate 蒙混）。
const regStarts = [...handler.matchAll(/register\(/g)].map((m) => m.index)
const regBlocks = regStarts.map((start, i) =>
  handler.slice(start, i + 1 < regStarts.length ? regStarts[i + 1] : undefined),
)
const notBlankRegBlock =
  regBlocks.find((b) => /kind:\s*['"]notBlank['"]/.test(b)) || ''
checks.push([
  'handlerRegistry.ts notBlank 的 register 块含 validate 且含 trim',
  /validate/.test(notBlankRegBlock) && /trim/.test(notBlankRegBlock),
])

// ── nodes.ts：NotBlankConstraintNodeData 接口 + 加入联合 ─────────────
checks.push([
  'nodes.ts 含 interface NotBlankConstraintNodeData',
  /interface\s+NotBlankConstraintNodeData/.test(nodes),
])
// 用出现次数 ≥2 判定"接口定义 + 联合成员"两处都在（单靠接口声明只算 1 次）。
// 这样无论联合写成单行 `| NotBlankConstraintNodeData` 还是多行 `|` 形式都能命中，
// 且能抓住"只声明接口、忘加进 CustomNodeData 联合"的常见错误。
const ncdCount = (nodes.match(/NotBlankConstraintNodeData/g) || []).length
checks.push([
  `NotBlankConstraintNodeData 在 nodes.ts 出现 ≥2 次（接口 + 联合，当前 ${ncdCount}）`,
  ncdCount >= 2,
])

// ── i18n.ts：notBlank 条目 + name + description（双侧） ─────────────
// 注意：seed 里 notNull 已含 name/description，故必须把检查限定在 notBlank 块内，
// 否则不新增 notBlank 也会因 notNull 的字段而误判通过。
const notBlankBlock = i18n.match(/notBlank\s*:\s*\{([\s\S]*?)\}/)
const notBlankBody = notBlankBlock ? notBlankBlock[1] : ''
checks.push(['i18n.ts 含 notBlank 条目', notBlankBlock !== null])
checks.push([
  'i18n.ts notBlank 块含 name 字段',
  /\bname\s*:/.test(notBlankBody),
])
checks.push([
  'i18n.ts notBlank 块含 nameEn 字段',
  /\bnameEn\s*:/.test(notBlankBody),
])
checks.push([
  'i18n.ts notBlank 块含 description 字段',
  /\bdescription\s*:/.test(notBlankBody),
])
checks.push([
  'i18n.ts notBlank 块含 descriptionEn 字段',
  /\bdescriptionEn\s*:/.test(notBlankBody),
])

// ── 跨文件一致性 ────────────────────────────────────────────────────
// (a) kind 标识 'notBlank'（带引号的字符串字面量）在 3 个注册表文件中一致出现：
//     constraintMeta(kind) + nodeDataBuilder(registerBuilder arg) + handlerRegistry(kind)。
//     nodes.ts 用的是标识符（NotBlankConstraintNodeData）、i18n 用的是无引号属性键，
//     故只统计这 3 个注册表文件。
const registryKindHits = [meta, builder, handler].filter((s) =>
  /['"]notBlank['"]/.test(s)
).length
checks.push([
  `kind 'notBlank' 在 3 个注册表文件中一致出现（当前 ${registryKindHits}/3）`,
  registryKindHits === 3,
])

// (b) 改动是 additive：NotNull 的注册在 5 个文件里都保留（用 otNull 同时匹配 notNull/NotNull）
const allPreserveNotNull = [meta, builder, handler, nodes, i18n].every((s) =>
  /otNull/.test(s)
)
checks.push(['改动 additive：NotNull 在 5 文件中均保留', allPreserveNotNull])

// ── 输出 ────────────────────────────────────────────────────────────
const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

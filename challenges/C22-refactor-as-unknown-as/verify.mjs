// verify.mjs — C22 静态校验：清除 as unknown as + 引入类型守卫 + 保留导出。
// 纯静态（读源文件文本），不跑 tsc、不执行 agent 代码。
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

// 检查 2（关键）：as unknown as 出现次数 == 0
const asUnknownCount = (src.match(/\bas\s+unknown\s+as\b/g) || []).length
checks.push([
  `清除全部 as unknown as（当前 ${asUnknownCount}，应 == 0）`,
  asUnknownCount === 0,
])

// 检查 3：至少 2 个类型守卫（typeof x === / 'k' in x / isXxx 谓词函数）
const typeofCount = (src.match(/\btypeof\s+[\w.]+\s*===/g) || []).length
const inCount = (src.match(/['"]\w+['"]\s+in\s+\w/g) || []).length
const isFnCount = (src.match(/\b(?:function|const)\s+is[A-Z]\w*/g) || []).length
const guardCount = typeofCount + inCount + isFnCount
checks.push([
  `引入至少 2 个类型守卫 typeof/in/isXxx（当前 ${guardCount}：typeof=${typeofCount}, in=${inCount}, isXxx=${isFnCount}）`,
  guardCount >= 2,
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

// 检查 8：未用 as any as 之类的变体绕过
const asAnyCastCount = (src.match(/\bas\s+any\s+as\b/g) || []).length
checks.push([
  `未用 as any as 变体绕过（当前 ${asAnyCastCount}，应 == 0）`,
  asAnyCastCount === 0,
])

// 输出
const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

/**
 * X03 verify — 真实 Precis 前端仓库上的"处方式重构 + 回归门"验证。
 *
 * 退出码：0 = PASS，非 0 = FAIL。
 * stdout 首行：PASS 或 FAIL。
 *
 * 三道门：
 *   门 1 结构检查（静态）：
 *     - 新文件 connectionTypeRules.ts 存在，且以 export 形式导出全部 9 个符号
 *     - 旧文件 connectionStateSync.ts 不再含这 9 个符号的【定义】
 *       （锚定行首的 const/function 声明形态匹配，不是子串扫描——
 *        旧文件中合法残留的是 import 与使用，不是定义）
 *     - 旧文件从 './connectionTypeRules' import 这 9 个符号
 *     - 新文件无反向依赖（不得 import connectionStateSync 或 graphStore）
 *     - 新文件的 isConstraintNodeType 引自 constraintMeta 叶子模块（非 barrel）
 *   门 2 行为等价（golden-master）：
 *     把 test_x03_type_rules.test.ts 临时复制到 frontend/tests/x03/，
 *     用 vitest 跑这一份注入测试（真值表 + 固定图 patch 序列），跑完删除。
 *   门 3 回归门：
 *     完整跑 frontend/tests/stores/graphStore/ 下全部既有测试，必须全绿。
 *
 * 注意：不能在 try/catch 里直接 process.exit()——会跳过 finally 清理。
 * 先记录结果，清理完成后统一输出、统一退出。
 */
import { copyFileSync, mkdirSync, unlinkSync, rmdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..') // D:/Precis/Precis
const FRONTEND_DIR = join(REPO_ROOT, 'frontend')
const MODULES_DIR = join(FRONTEND_DIR, 'src', 'stores', 'graphStore', 'modules')
const NEW_FILE = join(MODULES_DIR, 'connectionTypeRules.ts')
const OLD_FILE = join(MODULES_DIR, 'connectionStateSync.ts')

const TEST_SRC = join(__dirname, 'test_x03_type_rules.test.ts')
const INJECT_DIR = join(FRONTEND_DIR, 'tests', 'x03')
const TEST_DST = join(INJECT_DIR, 'test_x03_type_rules.test.ts')
const REL_INJECTED = 'tests/x03/test_x03_type_rules.test.ts'
const REL_REGRESSION = 'tests/stores/graphStore/'

const CONSTS = ['CHILDREN_CAPABLE_TYPES', 'DATA_SOURCE_TYPES', 'SCHEMA_TYPES', 'SKIP_EDGE_KINDS']
const FUNCS = [
  'isChildrenCapableType',
  'isParentCapableType',
  'isDataSourceType',
  'isSchemaType',
  'shouldSkipEdge',
]
const ALL_SYMBOLS = [...CONSTS, ...FUNCS]

const checks = [] // [描述, 是否通过, 门名]
const add = (gate, desc, ok) => checks.push([desc, !!ok, gate])

// ---------- 前置检查（不复制文件，直接判 FAIL） ----------
function precheck() {
  if (!existsSync(TEST_SRC)) {
    console.log('FAIL')
    console.log(`注入测试源文件不存在: ${TEST_SRC}`)
    process.exit(1)
  }
  if (!existsSync(FRONTEND_DIR)) {
    console.log('FAIL')
    console.log(`前端目录不存在: ${FRONTEND_DIR}`)
    process.exit(1)
  }
  const VITEST_BIN = join(FRONTEND_DIR, 'node_modules', '.bin', 'vitest')
  if (!existsSync(VITEST_BIN)) {
    console.log('FAIL')
    console.log(`未找到 vitest: ${VITEST_BIN}`)
    console.log('当前 frontend/ 缺少 node_modules（worktree/副本不含依赖），请先二选一：')
    console.log('  1) 安装依赖: cd frontend && npm ci')
    console.log(
      '  2) (Windows) 建 junction 共享主仓库依赖: ' +
        'cmd /c mklink /J <worktree>\\frontend\\node_modules <主仓库>\\frontend\\node_modules'
    )
    process.exit(1)
  }
}
precheck()

// ---------- 门 1：结构检查 ----------
const newSrc = existsSync(NEW_FILE) ? readFileSync(NEW_FILE, 'utf-8') : null
const oldSrc = existsSync(OLD_FILE) ? readFileSync(OLD_FILE, 'utf-8') : null

add('结构', '新文件 connectionTypeRules.ts 存在', newSrc != null)
add('结构', '旧文件 connectionStateSync.ts 存在', oldSrc != null)

if (newSrc != null) {
  const missingConsts = CONSTS.filter(
    (n) => !new RegExp(`^export\\s+const\\s+${n}\\b`, 'm').test(newSrc)
  )
  add(
    '结构',
    `新文件导出 4 个常量集合${missingConsts.length ? '（缺: ' + missingConsts.join(', ') + '）' : ''}`,
    missingConsts.length === 0
  )
  const missingFuncs = FUNCS.filter(
    (n) => !new RegExp(`^export\\s+function\\s+${n}\\s*\\(`, 'm').test(newSrc)
  )
  add(
    '结构',
    `新文件导出 5 个函数${missingFuncs.length ? '（缺: ' + missingFuncs.join(', ') + '）' : ''}`,
    missingFuncs.length === 0
  )
  // 反向依赖：不得 import connectionStateSync 或 graphStore 下任何模块
  const importsStateSync =
    /from\s+['"][^'"]*connectionStateSync['"]/.test(newSrc) ||
    /import\s+['"][^'"]*connectionStateSync['"]/.test(newSrc)
  const importsGraphStore = /from\s+['"][^'"]*stores\/graphStore[^'"]*['"]/.test(newSrc)
  add('结构', '新文件无反向依赖（不 import connectionStateSync / graphStore）', !importsStateSync && !importsGraphStore)
  // 处方依赖来源：constraintMeta 叶子模块 + utils/nodes/regex
  const metaOk =
    /import\s+(?:type\s+)?\{[^}]*\bisConstraintNodeType\b[^}]*\}\s*from\s*['"]@\/services\/constraints\/constraintMeta['"]/.test(
      newSrc
    )
  add('结构', "新文件的 isConstraintNodeType 引自 '@/services/constraints/constraintMeta'", metaOk)
  const regexOk =
    /import\s+(?:type\s+)?\{[^}]*\bisRegexNodeType\b[^}]*\}\s*from\s*['"]@\/utils\/nodes\/regex['"]/.test(
      newSrc
    )
  add('结构', "新文件的 isRegexNodeType 引自 '@/utils/nodes/regex'", regexOk)
}

if (oldSrc != null) {
  // 定义形态匹配（锚定行首的声明），不误伤 import/使用
  const leftoverConsts = CONSTS.filter((n) =>
    new RegExp(`^\\s*(?:export\\s+)?const\\s+${n}\\b`, 'm').test(oldSrc)
  )
  const leftoverFuncs = FUNCS.filter((n) =>
    new RegExp(`^\\s*(?:export\\s+)?function\\s+${n}\\s*\\(`, 'm').test(oldSrc)
  )
  const leftover = [...leftoverConsts, ...leftoverFuncs]
  add(
    '结构',
    `旧文件不再定义 9 个被提取符号${leftover.length ? '（残留定义: ' + leftover.join(', ') + '）' : ''}`,
    leftover.length === 0
  )
  // 必须从 './connectionTypeRules' import 全部 9 个符号
  const importRe = /import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"]\.\/connectionTypeRules['"]/g
  let importedNames = ''
  let m
  while ((m = importRe.exec(oldSrc)) != null) {
    importedNames += '\n' + m[1]
  }
  const notImported = ALL_SYMBOLS.filter((n) => !new RegExp(`\\b${n}\\b`).test(importedNames))
  add(
    '结构',
    `旧文件从 './connectionTypeRules' import 全部 9 个符号${notImported.length ? '（缺: ' + notImported.join(', ') + '）' : ''}`,
    notImported.length === 0
  )
  add(
    '结构',
    '旧文件仍导出 createConnectionStateSyncModule',
    /^export\s+function\s+createConnectionStateSyncModule\s*\(/m.test(oldSrc)
  )
}

// ---------- 门 2 + 门 3：vitest 子进程 ----------
function runVitest(relTarget, timeoutMs) {
  try {
    const out = execSync(`npx vitest run ${relTarget}`, {
      cwd: FRONTEND_DIR,
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, out, err: '' }
  } catch (e) {
    return {
      ok: false,
      out: typeof e.stdout === 'string' ? e.stdout : '',
      err: (typeof e.stderr === 'string' ? e.stderr : '') + (e.killed ? '\n[vitest 进程超时被杀]' : ''),
    }
  }
}

let behaviorResult = { ok: false, out: '', err: '' }
let regressionResult = { ok: false, out: '', err: '' }

// 注入行为测试文件（verify 期间临时存在）
mkdirSync(INJECT_DIR, { recursive: true })
copyFileSync(TEST_SRC, TEST_DST)
try {
  // 门 2：行为等价（golden-master 注入测试）
  behaviorResult = runVitest(REL_INJECTED, 180000)
  // 门 3：回归门（既有 graphStore 测试全集；注入文件在 tests/x03/ 不在此目录，保证回归门纯粹）
  regressionResult = runVitest(REL_REGRESSION, 300000)
} finally {
  // 清理：无论成败都移除注入文件与空目录，保持真实仓库干净
  if (existsSync(TEST_DST)) {
    try {
      unlinkSync(TEST_DST)
    } catch {
      /* 忽略清理错误 */
    }
  }
  try {
    rmdirSync(INJECT_DIR)
  } catch {
    /* 目录非空或不存在，忽略 */
  }
}

add('行为', '行为等价：connectionTypeRules 真值表 + 模块 golden-master patch 序列（注入测试全绿）', behaviorResult.ok)
add('回归', '回归门：tests/stores/graphStore/ 全部既有测试保持全绿', regressionResult.ok)

// ---------- 统一输出 ----------
const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
let lastGate = ''
for (const [desc, ok, gate] of checks) {
  if (gate !== lastGate) {
    console.log(`── ${gate}检查 ──`)
    lastGate = gate
  }
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
if (!behaviorResult.ok) {
  console.log('--- 行为等价 vitest 输出（尾部） ---')
  console.log(behaviorResult.out.slice(-2000))
  if (behaviorResult.err) console.log(behaviorResult.err.slice(-800))
}
if (!regressionResult.ok) {
  console.log('--- 回归门 vitest 输出（尾部） ---')
  console.log(regressionResult.out.slice(-2000))
  if (regressionResult.err) console.log(regressionResult.err.slice(-800))
}
process.exit(okAll ? 0 : 1)

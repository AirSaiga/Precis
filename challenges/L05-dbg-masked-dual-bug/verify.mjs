/**
 * L05 verify — "清空画布 → 撤销"链双重缺陷修复的多级评分。
 *
 * 退出码：0 = 评分完成（仅环境异常才非 0）。
 * stdout 首行：SCORE: n/m，随后逐行 `  [i/j] 子项名：说明`。
 *
 * 评分项（总分 8）：
 *   - 修 A（0-2）：清空入历史（1）+ 撤销恢复完整画布（1）。
 *   - 修 B（0-3）：撤销后数据源索引一致（2）+ 撤销后重复源检测生效（1）。
 *     B 的用例在 A 未修时同样失败（undo 无法恢复出节点），修 A 后 B 才暴露。
 *   - 回归门（0-2）：graphStore 既有 history/assembly/assets/schemaSourceIndex/clipboard
 *     测试文件全绿。
 *   - 质量门（0-1）：src/stores/graphStore/ ESLint（error 级）0 错误。
 *
 * 清理：注入测试文件在 finally 中删除，不污染真实仓库。
 */
import { copyFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const FRONTEND_DIR = join(REPO_ROOT, 'frontend')
const TEST_SRC = join(__dirname, 'test_l05_masked_dual_bug.test.ts')
const TEST_DST = join(FRONTEND_DIR, 'tests', 'stores', 'graphStore', 'test_l05_masked_dual_bug.test.ts')

// 隐藏用例 → 分值映射（总分 8）
const ITEM_SCORES = new Map([
  ['l05-a1-clear-records-history', 1],
  ['l05-a2-undo-restores-canvas', 1],
  ['l05-b1-index-consistent-after-undo', 2],
  ['l05-b2-duplicate-detection-after-undo', 1],
])
const REGRESSION_FILES = [
  'tests/stores/graphStore/history.test.ts',
  'tests/stores/graphStore/assembly.test.ts',
  'tests/stores/graphStore/assets.test.ts',
  'tests/stores/graphStore/schemaSourceIndex.test.ts',
  'tests/stores/graphStore/clipboard.test.ts',
]

// ---------- 前置检查 ----------
function precheck() {
  if (!existsSync(TEST_SRC)) {
    console.log('SCORE: 0/8')
    console.log(`  [✗] 前置检查: 注入测试源文件不存在: ${TEST_SRC}`)
    process.exit(1)
  }
  if (!existsSync(FRONTEND_DIR)) {
    console.log('SCORE: 0/8')
    console.log(`  [✗] 前置检查: 前端目录不存在: ${FRONTEND_DIR}`)
    process.exit(1)
  }
  const VITEST_BIN = join(FRONTEND_DIR, 'node_modules', '.bin', 'vitest')
  if (!existsSync(VITEST_BIN)) {
    console.log('SCORE: 0/8')
    console.log(`  [✗] 前置检查: 未找到 vitest: ${VITEST_BIN}`)
    console.log('当前 frontend/ 缺少 node_modules（worktree/副本不含依赖），请先二选一：')
    console.log('  1) 安装依赖: cd frontend && npm ci')
    console.log(
      '  2) (Windows) 建 junction 共享主仓库依赖: ' +
        'powershell -Command "New-Item -ItemType Junction -Path <worktree>\\frontend\\node_modules -Target <主仓库>\\frontend\\node_modules"'
    )
    process.exit(1)
  }
}
precheck()

function runVitest(relTargets, { json = false, timeout = 240000 } = {}) {
  const reporter = json ? '--reporter=json' : '--reporter=dot'
  const cmd = `npx vitest run ${relTargets.join(' ')} ${reporter}`
  try {
    const out = execSync(cmd, {
      cwd: FRONTEND_DIR,
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, stdout: out, stderr: '' }
  } catch (e) {
    return {
      ok: false,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: (typeof e.stderr === 'string' ? e.stderr : '') + (e.killed ? '\n[vitest 超时被杀]' : ''),
    }
  }
}

function parseVitestJson(stdout) {
  try {
    return JSON.parse(stdout)
  } catch {
    const first = stdout.indexOf('{')
    const last = stdout.lastIndexOf('}')
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(stdout.slice(first, last + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

// ---------- 注入并运行隐藏行为测试 ----------
let injected = false
let behaviorRun = { ok: false, stdout: '', stderr: '' }
const testStatus = new Map()
let behaviorOutput = ''

try {
  mkdirSync(dirname(TEST_DST), { recursive: true })
  copyFileSync(TEST_SRC, TEST_DST)
  injected = true

  behaviorRun = runVitest(['tests/stores/graphStore/test_l05_masked_dual_bug.test.ts'], { json: true })
  behaviorOutput = behaviorRun.ok ? behaviorRun.stdout : behaviorRun.stdout + '\n' + behaviorRun.stderr
  // 注意：vitest 失败（exit≠0）时同样会输出 JSON 报告，必须照样解析，
  // 否则失败状态下各子项会被误标为"未执行"。
  const parsed = parseVitestJson(behaviorRun.stdout)
  if (parsed && Array.isArray(parsed.testResults)) {
    for (const suite of parsed.testResults) {
      for (const a of suite.assertionResults || []) {
        for (const key of ITEM_SCORES.keys()) {
          if (a.fullName && a.fullName.includes(key)) {
            testStatus.set(key, a.status === 'passed')
          }
        }
      }
    }
  }
} finally {
  if (existsSync(TEST_DST)) {
    try {
      unlinkSync(TEST_DST)
    } catch {
      /* 忽略 */
    }
  }
}

// ---------- 行为得分（A 2 分 + B 3 分） ----------
const aScore = ['l05-a1-clear-records-history', 'l05-a2-undo-restores-canvas'].reduce(
  (acc, k) => acc + (testStatus.get(k) === true ? ITEM_SCORES.get(k) : 0),
  0
)
const bScore = ['l05-b1-index-consistent-after-undo', 'l05-b2-duplicate-detection-after-undo'].reduce(
  (acc, k) => acc + (testStatus.get(k) === true ? ITEM_SCORES.get(k) : 0),
  0
)

// ---------- 回归门（0-2） ----------
const regRun = runVitest(REGRESSION_FILES, { json: false })
const regScore = regRun.ok ? 2 : 0

// ---------- 质量门（0-1） ----------
let eslintOk = false
let eslintErr = ''
try {
  execSync('npx eslint src/stores/graphStore --quiet', {
    cwd: FRONTEND_DIR,
    encoding: 'utf-8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  eslintOk = true
} catch (e) {
  eslintErr = typeof e.stdout === 'string' ? e.stdout : ''
}

// ---------- 汇总 ----------
const total = 8
const score = aScore + bScore + regScore + (eslintOk ? 1 : 0)
const statusText = (k) => (testStatus.get(k) === true ? '✓' : testStatus.get(k) === false ? '✗' : '未执行')

console.log(`SCORE: ${score}/${total}`)
console.log(
  `  [${aScore}/2] 修复 A（清空-撤销链）: 清空入历史 ${statusText('l05-a1-clear-records-history')}、` +
    `撤销恢复完整画布 ${statusText('l05-a2-undo-restores-canvas')}`
)
console.log(
  `  [${bScore}/3] 修复 B（撤销后一致性）: 索引一致 ${statusText('l05-b1-index-consistent-after-undo')}(2 分)、` +
    `重复源检测生效 ${statusText('l05-b2-duplicate-detection-after-undo')}(1 分)`
)
console.log(`  [${regScore}/2] 回归门: graphStore 既有 history/assembly/assets/schemaSourceIndex/clipboard 测试${regRun.ok ? '全绿' : '有失败'}`)
console.log(`  [${eslintOk ? 1 : 0}/1] 质量门: src/stores/graphStore/ ESLint(error 级) ${eslintOk ? '通过' : '有 error'}`)

if (score < total) {
  console.log('--- 隐藏行为测试输出（尾部） ---')
  console.log(behaviorOutput.slice(-2500))
}
if (!regRun.ok) {
  console.log('--- 回归门输出（尾部） ---')
  console.log(regRun.stdout.slice(-1500))
}
if (eslintErr) {
  console.log('--- eslint 输出（尾部） ---')
  console.log(eslintErr.slice(-1500))
}
if (injected) {
  console.log('  [✓] 清理: 注入测试文件已移除')
}
process.exit(0)

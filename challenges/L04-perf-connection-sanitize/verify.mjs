/**
 * L04 verify — connectionPolicyService.sanitizeConnections 性能优化多级评分。
 *
 * 退出码：0 = 评分完成（仅环境异常才非 0）。
 * stdout 首行：SCORE: n/m，随后逐行 `  [i/j] 子项名：说明`。
 *
 * 评分项（总分 9）：
 *   - 等价门（golden-master，0-3）：注入测试内固化了一份"现状实现"行为的参照实现，
 *     与候选实现在大边集/边界场景逐条对比（内容+顺序+原因字段）。3 组场景各 1 分。
 *     **门控**：等价分只在"存在实质性能提升"（加速比 >= 门控阈值）时计分——
 *     否则未改动代码也能白拿等价分，"未实现"状态必须得低分。
 *   - 耗时档（0-3）：千边量级（1500 边）场景下同进程测量候选实现 vs 参照实现，
 *     按加速比分三档。
 *   - 回归门（0-2）：frontend/tests/services/canvas/ 与 tests/services/rules/ 全绿。
 *   - 质量门（0-1）：两个目标文件 ESLint（error 级）0 错误 + vue-tsc 过滤后 0 错误。
 *
 * 清理：注入测试与耗时结果文件在 finally 中删除，不污染真实仓库。
 */
import {
  copyFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const FRONTEND_DIR = join(REPO_ROOT, 'frontend')
const TEST_SRC = join(__dirname, 'test_l04_sanitize.test.ts')
const TEST_DST = join(FRONTEND_DIR, 'tests', 'services', 'canvas', 'test_l04_sanitize.test.ts')
const TIMING_FILE = join(FRONTEND_DIR, '.l04_timing_result.json')

const TARGET_FILES = [
  'src/services/canvas/connectionPolicyService.ts',
  'src/composables/validation/useConnectionValidator.ts',
]

// 耗时档阈值（同进程 ratio 测量；T1 兼作"实质提升"门控阈值）
// 校准基准（3000 边场景，同机实测）：未优化 ≈ 0.7；只修内层 ≈ 2.1；全套 ≈ 5.2
const GATE_RATIO = 1.15
const TIER3_RATIO = 3.2
const TIER2_RATIO = 2.2

// 等价分组：组内全部用例通过才得 1 分
const EQUIV_GROUPS = [
  ['l04-equiv-all-valid', 'l04-equiv-mixed-invalid'],
  ['l04-equiv-duplicates-multiplicity', 'l04-equiv-boundary-handles'],
  ['l04-equiv-placeholder-order', 'l04-equiv-big-generated'],
]
const ALL_EQUIV_TESTS = EQUIV_GROUPS.flat()

// ---------- 前置检查（不复制文件，直接非 0 退出） ----------
function precheck() {
  if (!existsSync(TEST_SRC)) {
    console.log('SCORE: 0/9')
    console.log(`  [✗] 前置检查: 注入测试源文件不存在: ${TEST_SRC}`)
    process.exit(1)
  }
  if (!existsSync(FRONTEND_DIR)) {
    console.log('SCORE: 0/9')
    console.log(`  [✗] 前置检查: 前端目录不存在: ${FRONTEND_DIR}`)
    process.exit(1)
  }
  const VITEST_BIN = join(FRONTEND_DIR, 'node_modules', '.bin', 'vitest')
  if (!existsSync(VITEST_BIN)) {
    console.log('SCORE: 0/9')
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

// ---------- vitest 运行封装 ----------
function runVitest(relTargets, { json = false, timeout = 180000 } = {}) {
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

// ---------- 注入并运行行为测试 ----------
let injected = false
let timingData = null
let equivResults = new Map()
let timingRunOk = false
let timingOutput = ''

try {
  mkdirSync(dirname(TEST_DST), { recursive: true })
  copyFileSync(TEST_SRC, TEST_DST)
  injected = true

  const run = runVitest(['tests/services/canvas/test_l04_sanitize.test.ts'], { json: true })
  // 注意：vitest 失败（exit≠0）时同样会输出 JSON 报告，必须照样解析。
  const parsed = parseVitestJson(run.stdout)
  timingRunOk = run.ok
  timingOutput = run.ok ? '' : run.stdout + '\n' + run.stderr

  if (parsed && Array.isArray(parsed.testResults)) {
    for (const suite of parsed.testResults) {
      for (const a of suite.assertionResults || []) {
        // fullName 形如 "l04 golden 等价 > l04-equiv-all-valid：..."
        for (const t of ALL_EQUIV_TESTS) {
          if (a.fullName && a.fullName.includes(t)) {
            equivResults.set(t, a.status === 'passed')
          }
        }
      }
    }
  }

  if (existsSync(TIMING_FILE)) {
    try {
      timingData = JSON.parse(readFileSync(TIMING_FILE, 'utf-8'))
    } catch {
      timingData = null
    }
  }
} finally {
  // 清理注入测试与耗时结果文件
  if (existsSync(TEST_DST)) {
    try {
      unlinkSync(TEST_DST)
    } catch {
      /* 忽略 */
    }
  }
  if (existsSync(TIMING_FILE)) {
    try {
      rmSync(TIMING_FILE, { force: true })
    } catch {
      /* 忽略 */
    }
  }
}

// ---------- 等价分（3 组 × 1 分） ----------
let equivPassed = 0
for (const group of EQUIV_GROUPS) {
  const ok = group.every((t) => equivResults.get(t) === true)
  if (ok) equivPassed += 1
}

// ---------- 耗时档（ratio 三档） ----------
const ratio = timingData && typeof timingData.ratio === 'number' && timingData.ratio > 0 ? timingData.ratio : 0
let timingTier = 0
if (ratio >= TIER3_RATIO) timingTier = 3
else if (ratio >= TIER2_RATIO) timingTier = 2
else if (ratio >= GATE_RATIO) timingTier = 1

// 门控：无实质加速时等价分清零（防止不改代码白拿等价分）
const hasRealSpeedup = ratio >= GATE_RATIO
const equivScore = hasRealSpeedup ? equivPassed : 0

// ---------- 回归门（2 个目录 × 1 分） ----------
const regCanvas = runVitest(['tests/services/canvas'], { json: false, timeout: 240000 })
const regRules = runVitest(['tests/services/rules'], { json: false, timeout: 240000 })
const regScore = (regCanvas.ok ? 1 : 0) + (regRules.ok ? 1 : 0)

// ---------- 质量门（1 分：eslint error 级 + vue-tsc 过滤错误数） ----------
let eslintOk = false
let eslintErr = ''
try {
  execSync(`npx eslint ${TARGET_FILES.join(' ')} --quiet`, {
    cwd: FRONTEND_DIR,
    encoding: 'utf-8',
    timeout: 120000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  eslintOk = true
} catch (e) {
  eslintErr = typeof e.stdout === 'string' ? e.stdout : ''
}

let tscErrors = -1
let tscOutput = ''
try {
  const out = execSync('npx vue-tsc --noEmit -p tsconfig.json', {
    cwd: FRONTEND_DIR,
    encoding: 'utf-8',
    timeout: 420000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  tscOutput = out
  tscErrors = 0
} catch (e) {
  tscOutput = (typeof e.stdout === 'string' ? e.stdout : '') + (typeof e.stderr === 'string' ? e.stderr : '')
  // 只统计与目标文件相关的错误行（vue-tsc 输出形如 "src/...ts(line,col): error TS..."
  const lines = tscOutput.split(/\r?\n/)
  tscErrors = lines.filter(
    (l) => TARGET_FILES.some((f) => l.includes(f)) && /error TS\d+/.test(l)
  ).length
}
const qualityOk = eslintOk && tscErrors === 0

// ---------- 汇总 ----------
const total = 9
const score = equivScore + timingTier + regScore + (qualityOk ? 1 : 0)

console.log(`SCORE: ${score}/${total}`)
const gateNote =
  equivPassed > 0 && !hasRealSpeedup ? '（未检出实质加速，等价分按门控清零）' : ''
console.log(`  [${equivScore}/3] golden 等价门: ${equivPassed}/3 组场景与参照输出逐条一致${gateNote}`)
console.log(
  `  [${timingTier}/3] 耗时档: 参照 ${timingData ? timingData.refMs.toFixed(1) : 'N/A'}ms / 实现 ` +
    `${timingData ? timingData.optMs.toFixed(1) : 'N/A'}ms，加速比 ${ratio.toFixed(2)}` +
    `（档位阈值 ${GATE_RATIO}/${TIER2_RATIO}/${TIER3_RATIO}）`
)
console.log(`  [${regScore}/2] 回归门: canvas ${regCanvas.ok ? '绿' : '红'}、rules ${regRules.ok ? '绿' : '红'}`)
console.log(
  `  [${qualityOk ? 1 : 0}/1] 质量门: eslint ${eslintOk ? '通过' : '有 error'}、` +
    `vue-tsc 相关文件错误 ${tscErrors < 0 ? '未执行' : tscErrors} 条`
)

if (!timingRunOk || equivPassed < EQUIV_GROUPS.length) {
  console.log('--- 注入测试输出（尾部） ---')
  console.log(timingOutput.slice(-2500))
}
if (!regCanvas.ok) {
  console.log('--- 回归门 canvas 输出（尾部） ---')
  console.log(regCanvas.stdout.slice(-1200))
}
if (!regRules.ok) {
  console.log('--- 回归门 rules 输出（尾部） ---')
  console.log(regRules.stdout.slice(-1200))
}
if (eslintErr) {
  console.log('--- eslint 输出（尾部） ---')
  console.log(eslintErr.slice(-1500))
}
if (tscErrors > 0) {
  console.log('--- vue-tsc 目标文件相关错误 ---')
  const lines = tscOutput.split(/\r?\n/).filter((l) => TARGET_FILES.some((f) => l.includes(f)))
  console.log(lines.slice(0, 20).join('\n'))
}
if (injected) {
  console.log('  [✓] 清理: 注入测试与耗时文件已移除')
}
process.exit(0)

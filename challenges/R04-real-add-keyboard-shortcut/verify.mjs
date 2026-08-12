/**
 * R04 verify — 在真实 Precis 前端仓库上验证 format canvas 快捷键全链路。
 *
 * 退出码：0 = PASS，非 0 = FAIL。
 * stdout 首行：PASS 或 FAIL，随后按 `  [✓]/[✗]` 列出明细。
 *
 * 流程：
 *   1. 把 test_format_shortcut.test.ts 复制到
 *      frontend/tests/features/keyboard/test_r04_format.test.ts
 *   2. 在 frontend/ 下以 vitest 运行该注入文件（功能测试）
 *      （npx vitest run <path>，run 模式跑一次即退出，非 watch）
 *   3. 回归门：以相同 cwd 运行 keyboard 特性的 4 个既有测试文件
 *      （commandExecutor / platformAdapter / platformDetector / shortcutRegistry；
 *      新增命令若破坏注册管理器、平台适配或命令执行契约，回归即失败，整体判 FAIL）
 *   4. 无论成败，finally 清理复制进去的测试文件（不污染真实仓库）
 *   5. 判定并输出：注入测试与回归子集都通过才 PASS，首行 PASS/FAIL + [✓]/[✗] 明细
 *
 * 注意：不能在 try/catch 里直接 process.exit()——那会跳过 finally 导致清理不执行、
 * 临时测试文件残留污染真实仓库。改为先记录退出码，在 try/catch/finally 之后统一退出。
 */
import { copyFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..') // D:/Precis/Precis
const FRONTEND_DIR = join(REPO_ROOT, 'frontend')
const TEST_DST = join(
  FRONTEND_DIR,
  'tests',
  'features',
  'keyboard',
  'test_r04_format.test.ts'
)
const TEST_SRC = join(__dirname, 'test_format_shortcut.test.ts')
const REL_TEST = 'tests/features/keyboard/test_r04_format.test.ts'

// 回归门：keyboard 特性既有的 4 个测试文件（相对 frontend/，vitest 参数用正斜杠，
// Windows 下 npx/vitest 均可正确解析）。新增命令若破坏注册管理器 / 平台适配 /
// 命令执行契约，这些既有测试会红。
const REGRESSION_TARGETS = [
  'tests/features/keyboard/commandExecutor.test.ts',
  'tests/features/keyboard/platformAdapter.test.ts',
  'tests/features/keyboard/platformDetector.test.ts',
  'tests/features/keyboard/shortcutRegistry.test.ts',
]

// 0. 前置检查（不复制文件，直接判 FAIL）
if (!existsSync(TEST_SRC)) {
  console.log('FAIL')
  console.log(`测试源文件不存在: ${TEST_SRC}`)
  process.exit(1)
}
if (!existsSync(FRONTEND_DIR)) {
  console.log('FAIL')
  console.log(`前端目录不存在: ${FRONTEND_DIR}`)
  process.exit(1)
}
// worktree/副本通常不含 node_modules，vitest 不存在时给出明确指引而非裸报错
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

/**
 * 以统一的 cwd 运行一次 vitest（run 模式，首次启动较慢，超时 90s）。
 * 不抛异常——失败/超时都收敛为 { ok, stdout, stderr, timedOut }。
 */
function runVitest(relTargets) {
  const cmd = `npx vitest run ${relTargets.join(' ')} --reporter=verbose`
  try {
    const stdout = execSync(cmd, {
      cwd: FRONTEND_DIR,
      encoding: 'utf-8',
      timeout: 90000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, stdout, stderr: '', timedOut: false }
  } catch (e) {
    return {
      ok: false,
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      stderr: typeof e.stderr === 'string' ? e.stderr : '',
      timedOut: !!e.killed,
    }
  }
}

let injected = { ok: false, stdout: '', stderr: '', timedOut: false }
let regression = { ok: false, stdout: '', stderr: '', timedOut: false }

// 1. 复制测试文件进真实仓库（verify 期间临时存在）
// 目标目录可能不存在（如干净 worktree），先递归创建，避免 copyFileSync 抛裸异常
mkdirSync(dirname(TEST_DST), { recursive: true })
copyFileSync(TEST_SRC, TEST_DST)

try {
  // 2. 注入测试（vitest run，针对单个文件）
  injected = runVitest([REL_TEST])
  // 3. 回归门：既有 keyboard 测试（与注入测试同一 cwd/环境，只读运行）
  regression = runVitest(REGRESSION_TARGETS)
} finally {
  // 4. 清理：无论成败都移除临时测试文件，保持真实仓库干净
  // vitest run 不写持久缓存（.vite 缓存位于 node_modules/.vite，属依赖目录常态产物）
  if (existsSync(TEST_DST)) {
    try {
      unlinkSync(TEST_DST)
    } catch {
      // 忽略清理错误
    }
  }
}

// 5. 统一输出（清理已完成）：首行 PASS/FAIL，随后 [✓]/[✗] 明细
const passed = injected.ok && regression.ok
console.log(passed ? 'PASS' : 'FAIL')
console.log(`  [${injected.ok ? '✓' : '✗'}] 注入测试: ${REL_TEST}`)
console.log(`  [${regression.ok ? '✓' : '✗'}] 回归（既有测试）: ${REGRESSION_TARGETS.join(', ')}`)

console.log('--- 注入测试输出 ---')
console.log(injected.stdout.slice(-2500))
if (injected.stderr) {
  console.log('--- 注入测试 stderr ---')
  console.log(injected.stderr.slice(-1200))
}
if (injected.timedOut) {
  console.log('--- 注入测试 vitest 进程超时被杀 ---')
}

if (!regression.ok) {
  // 回归失败单独列出输出，便于定位被哪条既有测试挡住
  console.log('--- 回归失败输出 ---')
  console.log(regression.stdout.slice(-2500))
  if (regression.stderr) {
    console.log('--- 回归 stderr ---')
    console.log(regression.stderr.slice(-1200))
  }
  if (regression.timedOut) {
    console.log('--- 回归 vitest 进程超时被杀 ---')
  }
}

process.exit(passed ? 0 : 1)

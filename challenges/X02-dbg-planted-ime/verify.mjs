/**
 * X02 verify — 在真实 Precis 前端仓库上校验键盘监听器对 IME 合成态事件的处理。
 *
 * 退出码：0 = PASS，非 0 = FAIL。
 * stdout 首行：PASS 或 FAIL。
 *
 * 流程：
 *   1. 把 test_ime_guard.test.ts 复制到
 *      frontend/tests/features/keyboard/test_x02_ime_guard.test.ts
 *   2. 在 frontend/ 下以 vitest 运行 tests/features/keyboard 整个目录
 *      （注入的行为测试 + 该目录既有 4 个测试文件一并回归）
 *   3. 捕获输出，按退出码判定
 *   4. 无论成败，finally 清理复制进去的测试文件（不污染真实仓库）
 *
 * 预期行为：
 *   - plant.py 注入故障后运行 → FAIL（合成态事件穿透派发 shortcut）
 *   - 修复后运行 → PASS
 *   - 未注入的干净仓库运行 → PASS
 *
 * 注意：不能在 try/catch 里直接 process.exit()——那会跳过 finally 导致清理不执行、
 * 临时测试文件残留污染真实仓库。改为先记录退出码，在 try/catch/finally 之后统一退出。
 */
import { copyFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..') // <repo>/challenges/X02-dbg-planted-ime -> <repo>
const FRONTEND_DIR = join(REPO_ROOT, 'frontend')
const TEST_DST = join(
  FRONTEND_DIR,
  'tests',
  'features',
  'keyboard',
  'test_x02_ime_guard.test.ts'
)
const TEST_SRC = join(__dirname, 'test_ime_guard.test.ts')
// 运行整个 keyboard 测试目录：注入测试 + 既有 4 个测试文件一起回归
const REL_TEST_TARGET = 'tests/features/keyboard'

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

let exitCode = 1
let captured = ''
let capturedErr = ''
let timedOut = false

// 1. 复制测试文件进真实仓库（verify 期间临时存在）
// 目标目录在仓库中已存在（既有 4 个键盘测试），mkdirSync 仅为兜底
mkdirSync(dirname(TEST_DST), { recursive: true })
copyFileSync(TEST_SRC, TEST_DST)

try {
  // 2. 运行 vitest（run 模式；覆盖注入测试 + 既有 4 个键盘测试，超时 150s）
  const output = execSync(`npx vitest run ${REL_TEST_TARGET} --reporter=verbose`, {
    cwd: FRONTEND_DIR,
    encoding: 'utf-8',
    timeout: 150000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  // 3. vitest 退出码 0 = 全部通过
  captured = output
  exitCode = 0
} catch (e) {
  // 退出码非 0 = 有失败或运行错误
  captured = typeof e.stdout === 'string' ? e.stdout : ''
  capturedErr = typeof e.stderr === 'string' ? e.stderr : ''
  timedOut = !!e.killed
  exitCode = 1
} finally {
  // 4. 清理：无论成败都移除临时测试文件，保持真实仓库干净
  if (existsSync(TEST_DST)) {
    try {
      unlinkSync(TEST_DST)
    } catch {
      // 忽略清理错误
    }
  }
}

// 5. 统一输出（清理已完成）
console.log(exitCode === 0 ? 'PASS' : 'FAIL')
console.log(captured.slice(-3000))
if (capturedErr) {
  console.log('--- stderr ---')
  console.log(capturedErr.slice(-1200))
}
if (timedOut) {
  console.log('--- vitest 进程超时被杀 ---')
}
process.exit(exitCode)

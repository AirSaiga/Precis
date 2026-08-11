/**
 * R04 verify — 在真实 Precis 前端仓库上验证 format canvas 快捷键全链路。
 *
 * 退出码：0 = PASS，非 0 = FAIL。
 * stdout 首行：PASS 或 FAIL。
 *
 * 流程：
 *   1. 把 test_format_shortcut.test.ts 复制到
 *      frontend/tests/features/keyboard/test_r04_format.test.ts
 *   2. 在 frontend/ 下以 vitest 运行该单个文件
 *      （npx vitest run <path>，run 模式跑一次即退出，非 watch）
 *   3. 捕获输出，按退出码判定
 *   4. 无论成败，finally 清理复制进去的测试文件（不污染真实仓库）
 *
 * 注意：不能在 try/catch 里直接 process.exit()——那会跳过 finally 导致清理不执行、
 * 临时测试文件残留污染真实仓库。改为先记录退出码，在 try/catch/finally 之后统一退出。
 */
import { copyFileSync, unlinkSync, existsSync } from 'node:fs'
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

let exitCode = 1
let captured = ''
let capturedErr = ''
let timedOut = false

// 1. 复制测试文件进真实仓库（verify 期间临时存在）
copyFileSync(TEST_SRC, TEST_DST)

try {
  // 2. 运行 vitest（run 模式，针对单个文件；首次启动较慢，超时 90s）
  const output = execSync(`npx vitest run ${REL_TEST} --reporter=verbose`, {
    cwd: FRONTEND_DIR,
    encoding: 'utf-8',
    timeout: 90000,
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
console.log(captured.slice(-2500))
if (capturedErr) {
  console.log('--- stderr ---')
  console.log(capturedErr.slice(-1200))
}
if (timedOut) {
  console.log('--- vitest 进程超时被杀 ---')
}
process.exit(exitCode)

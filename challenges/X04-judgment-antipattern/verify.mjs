/**
 * X04 verify — 校验 graphStore 连接模块 batchAddEdges 的实现方式与行为。
 *
 * 退出码：0 = PASS，非 0 = FAIL。
 * stdout 首行：PASS 或 FAIL。
 *
 * 三步判定（全部通过才算 PASS）：
 *   A. 静态扫描：收集 agent 改动/新增的 frontend/src 实现文件
 *      （git diff HEAD + git diff --cached + 提交对比 main + untracked/porcelain，
 *       agent 把改动 commit 后仅靠 git diff HEAD + untracked 会漏扫；
 *       git 不可用时回退到 task 指定的连接模块文件），
 *      检查画布边数组禁模式（edges.value.push / edges.value = ...filter / edges.value.splice）。
 *   B. 注入行为级 vitest：batchAddEdges 后全部边经 Vue Flow API 提交并进入
 *      画布边集合、reconcile 触发、空数组安全、createConnection 不回归。
 *   C. 回归该模块既有测试（connectionOps.test.ts / connectionStateSync.test.ts）。
 *
 * B/C 合并为一次 vitest run（注入文件 + 既有文件），finally 清理注入文件。
 */
import { copyFileSync, mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..') // <repo>/challenges/X04-... -> <repo>
const FRONTEND_DIR = join(REPO_ROOT, 'frontend')
const TEST_SRC = join(__dirname, 'test_batch_edges.test.ts')
const TEST_DST = join(
  FRONTEND_DIR,
  'tests',
  'stores',
  'graphStore',
  'test_x04_batch_edges.test.ts'
)
// 注入测试 + 该模块既有测试一起回归
const VITEST_TARGETS = [
  'tests/stores/graphStore/test_x04_batch_edges.test.ts',
  'tests/stores/graphStore/connectionOps.test.ts',
  'tests/stores/graphStore/connectionStateSync.test.ts',
]
// task 指定的实现文件（无论 git 是否可用都纳入扫描）
const TASK_FILE_REL = 'frontend/src/stores/graphStore/modules/connectionOps.ts'

// ---- 禁模式（作用于画布边数组，违反仓库「增量走 API」铁律）----
const FORBIDDEN_PATTERNS = [
  { name: 'edges.value.push（绕过 Vue Flow API 直接变更边数组）', re: /\bedges\s*\.\s*value\s*\.\s*push\s*\(/ },
  { name: 'edges.value = ...filter（数组替换式删边，绕过 onEdgesChange）', re: /\bedges\s*\.\s*value\s*=\s*[^;\n]*\.filter\s*\(/ },
  { name: 'edges.value.splice（绕过 Vue Flow API 原地变更边数组）', re: /\bedges\s*\.\s*value\s*\.\s*splice\s*\(/ },
]

// 0. 前置检查
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

// ---- A. 静态扫描 ----

/** 收集 agent 改动/新增的 frontend/src 文件。
 *  数据源并集：git diff HEAD（工作区 vs HEAD）+ git diff --cached（暂存区）+
 *  git ls-files --others（untracked）+ git status --porcelain 解析（暂存/未暂存/
 *  untracked/重命名目标）+ 提交对比 main（见下）。agent 把改动 commit 之后，
 *  git diff HEAD / --cached / porcelain 会全空导致漏扫（行为门兜底但不完整），
 *  因此多源并集 + 提交对比保证覆盖 committed 场景。 */
function collectChangedSrcFiles() {
  const files = new Set()
  let gitOk = true
  const run = (args) => {
    try {
      return execSync(`git ${args}`, {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      gitOk = false
      return ''
    }
  }
  // 工作区相对 HEAD 的改动（含暂存后的内容）
  const head = run('diff --name-only HEAD -- frontend/src')
  // 暂存区改动（git add 后未 commit；commit 内容由回放/暂存落到工作区时也在此）
  const cached = run('diff --cached --name-only -- frontend/src')
  // untracked 文件
  const untracked = run('ls-files --others --exclude-standard -- frontend/src')
  // porcelain 全量解析（暂存 + 未暂存 + untracked + 重命名），与上面三源互为冗余兜底
  const porcelain = run('status --porcelain --untracked-files=all -- frontend/src')
  const addLines = (out) => {
    for (const line of out.split('\n')) {
      const rel = line.trim()
      if (rel) files.add(rel)
    }
  }
  addLines(head)
  addLines(cached)
  addLines(untracked)
  // porcelain 行格式：`XY 路径` 或 `XY 旧路径 -> 新路径`（重命名）；路径可能被双引号包裹
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue
    let rest = line.slice(3) // 去掉 XY 状态 + 空格
    if (rest.includes(' -> ')) {
      rest = rest.split(' -> ').pop() || '' // 重命名取新路径
    }
    const unquoted = rest.trim().replace(/^"(.*)"$/, '$1')
    if (unquoted) files.add(unquoted)
  }
  // 已 commit 的改动：worktree 由 main 检出（--detach），agent 提交后 HEAD 前移，
  // 上面各源全空。若 main 是 HEAD 的祖先，用 git diff main HEAD 补上提交内容；
  // 任一前置不成立（无 main / HEAD 未前移 / 非祖先）则静默跳过，不影响其它收集。
  try {
    execSync('git merge-base --is-ancestor main HEAD', { cwd: REPO_ROOT, stdio: 'ignore' })
    try {
      const committed = execSync('git diff main HEAD --name-only -- frontend/src', {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      addLines(committed)
    } catch {
      // 提交对比 diff 失败：跳过，不影响其它收集
    }
  } catch {
    // main 不存在或不是 HEAD 的祖先：跳过提交对比
  }
  if (!gitOk) {
    console.log('[scan] git 不可用（非 git 副本？），回退为仅扫描 task 指定文件')
  }
  // task 指定文件始终纳入（即使 agent 只改了它且 git 不可用）
  files.add(TASK_FILE_REL)
  return [...files]
    .map((rel) => join(REPO_ROOT, rel))
    .filter((abs) => /\.(ts|vue)$/.test(abs) && existsSync(abs))
}

/** 去注释且保留行号：块注释内容清空（保留换行），行注释删除（避免误伤 URL 用负向后瞻） */
function stripComments(code) {
  const noBlock = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  return noBlock.replace(/(?<!:)\/\/[^\n]*/g, '')
}

function scanFiles(files) {
  const violations = []
  for (const abs of files) {
    const rel = abs.startsWith(REPO_ROOT) ? abs.slice(REPO_ROOT.length + 1) : abs
    const stripped = stripComments(readFileSync(abs, 'utf-8'))
    const lines = stripped.split('\n')
    lines.forEach((line, i) => {
      for (const p of FORBIDDEN_PATTERNS) {
        if (p.re.test(line)) {
          violations.push({ file: rel.split(sep).join('/'), line: i + 1, pattern: p.name })
        }
      }
    })
  }
  return violations
}

const scanTargetFiles = collectChangedSrcFiles()
const violations = scanFiles(scanTargetFiles)
const scanOk = violations.length === 0

// ---- B + C. vitest（注入行为测试 + 既有回归）----
let vitestExit = 1
let captured = ''
let capturedErr = ''
let timedOut = false

mkdirSync(dirname(TEST_DST), { recursive: true })
copyFileSync(TEST_SRC, TEST_DST)

try {
  const output = execSync(`npx vitest run ${VITEST_TARGETS.join(' ')} --reporter=verbose`, {
    cwd: FRONTEND_DIR,
    encoding: 'utf-8',
    timeout: 150000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  captured = output
  vitestExit = 0
} catch (e) {
  captured = typeof e.stdout === 'string' ? e.stdout : ''
  capturedErr = typeof e.stderr === 'string' ? e.stderr : ''
  timedOut = !!e.killed
  vitestExit = 1
} finally {
  if (existsSync(TEST_DST)) {
    try {
      unlinkSync(TEST_DST)
    } catch {
      // 忽略清理错误
    }
  }
}

// ---- 汇总 ----
const pass = scanOk && vitestExit === 0
console.log(pass ? 'PASS' : 'FAIL')
console.log('')
console.log('== A. 静态扫描（画布边数组禁模式）==')
console.log(`扫描文件（git diff HEAD / --cached / 提交对比 main / untracked + porcelain，frontend/src，共 ${scanTargetFiles.length} 个）:`)
for (const f of scanTargetFiles) {
  const rel = f.startsWith(REPO_ROOT) ? f.slice(REPO_ROOT.length + 1) : f
  console.log(`  - ${rel.split(sep).join('/')}`)
}
if (scanOk) {
  console.log('  [✓] 未发现 edges.value.push / edges.value=...filter / edges.value.splice')
} else {
  for (const v of violations) {
    console.log(`  [✗] ${v.file}:${v.line} — ${v.pattern}`)
  }
}
console.log('')
console.log(`== B/C. vitest 行为测试 + 既有回归 == ${vitestExit === 0 ? '[✓] 全部通过' : '[✗] 存在失败'}`)
console.log(captured.slice(-3000))
if (capturedErr) {
  console.log('--- stderr ---')
  console.log(capturedErr.slice(-1200))
}
if (timedOut) {
  console.log('--- vitest 进程超时被杀 ---')
}
process.exit(pass ? 0 : 1)

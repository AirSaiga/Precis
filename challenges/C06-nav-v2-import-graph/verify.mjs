import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const W = join(__dirname, 'workspace')

// Anti-cheat: capture stdout during require
const buf = []
const origLog = console.log
console.log = (...a) => buf.push(a.join(' '))
let nf, vi, asm, loadErr
try {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(join('workspace', 'nodeFactory')) || k.includes(join('workspace', 'v2Import')) || k.includes(join('workspace', 'assembly'))) delete require.cache[k]
  }
  nf = require(join(W, 'nodeFactory.js'))
  vi = require(join(W, 'v2Import.js'))
  asm = require(join(W, 'assembly.js'))
} catch (e) { loadErr = e }
console.log = origLog
const cheated = buf.some(s => /\bPASS\b|\bFAIL\b|\[✓\]|\[✗\]/.test(s))

const checks = []
checks.push(['3 个模块可加载', nf != null && vi != null && asm != null && loadErr == null])

// answers.js
const ansPath = join(W, 'answers.js')
const ansSrc = existsSync(ansPath) ? readFileSync(ansPath, 'utf-8') : ''
checks.push(['answers.js 存在', existsSync(ansPath)])
const q1 = ansSrc.match(/\/\/\s*Q1[:：]\s*(\w+)/)
checks.push(['Q1 = createNode', q1 != null && q1[1] === 'createNode'])
const q2 = ansSrc.match(/\/\/\s*Q2[:：]\s*(.+)/)
const q2ok = q2 != null && /null|跳过|skip|null|丢弃|drop/.test(q2[1])
checks.push(['Q2 描述未注册类型返回 null/被跳过', q2ok])
const q3 = ansSrc.match(/\/\/\s*Q3[:：]\s*(\d+)/)
checks.push(['Q3 = 2（assembly 聚合的模块数）', q3 != null && q3[1] === '2'])

// transform 注册
checks.push([
  "'transform' 已注册",
  nf != null && nf.listRegisteredTypes().includes('transform'),
])

// 端到端：importConfig 能创建 transform 节点
function _checkImport() {
  if (vi == null) return false
  try {
    const result = vi.importConfig({
      nodes: [
        { type: 'schema', id: 's1', table: 'users' },
        { type: 'transform', id: 't1', op: 'filter' },
        { type: 'constraint', id: 'c1', rule: 'not_null' },
      ],
    })
    return (result.created.length === 3
      && result.skipped.length === 0
      && result.created[1].type === 'transform'
      && result.created[1].op === 'filter')
  } catch (e) {
    return false
  }
}
checks.push(['importConfig 正确创建 transform 节点（端到端）', _checkImport()])

// 未注册类型仍被跳过（不回归）
function _checkUnknownSkipped() {
  if (vi == null) return false
  try {
    const result = vi.importConfig({ nodes: [{ type: 'mystery', id: 'x' }] })
    return result.created.length === 0 && result.skipped.length === 1
  } catch (e) {
    return false
  }
}
checks.push(['未注册类型仍被跳过（不回归）', _checkUnknownSkipped()])

if (cheated) {
  console.log('FAIL')
  console.log('  [✗] 检测到疑似作弊')
  process.exit(1)
}

const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
process.exit(okAll ? 0 : 1)

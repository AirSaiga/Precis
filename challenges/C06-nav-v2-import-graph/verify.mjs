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
checks.push(['Q1 答案匹配（importConfig 调用的节点创建函数名）', q1 != null && q1[1] === 'createNode'])
const q2 = ansSrc.match(/\/\/\s*Q2[:：]\s*(.+)/)
const q2ok = q2 != null && /null|跳过|skip|丢弃|drop/.test(q2[1])
checks.push(['Q2 答案匹配（未注册类型的处理方式）', q2ok])
const q3 = ansSrc.match(/\/\/\s*Q3[:：]\s*(\d+)/)
checks.push(['Q3 答案匹配（assembly 聚合的模块数）', q3 != null && q3[1] === '2'])
const q4 = ansSrc.match(/\/\/\s*Q4[:：]\s*(.+)/)
const q4ok = q4 != null && /静默|silent|无报错|没有报错|不报错|不立即暴露|延后|事后|难以发现|难发现|难排查|掩盖|悄悄|丢失|丢节点|丢数据|hidden/.test(q4[1].toLowerCase())
checks.push(['Q4 答案匹配（return null 静默跳过为何比抛错更危险）', q4ok])

// transform 注册
checks.push([
  "'transform' 已注册",
  nf != null && nf.listRegisteredTypes().includes('transform'),
])

// template 注册
checks.push([
  "'template' 已注册",
  nf != null && nf.listRegisteredTypes().includes('template'),
])

// 端到端：importConfig 能创建 transform 与 template 节点，skipped 为空
function _checkImport() {
  if (vi == null) return false
  try {
    const result = vi.importConfig({
      nodes: [
        { type: 'schema', id: 's1', table: 'users' },
        { type: 'transform', id: 't1', op: 'filter' },
        { type: 'template', id: 'tpl1', templateId: 'std_check', params: { strict: true } },
        { type: 'constraint', id: 'c1', rule: 'not_null' },
      ],
    })
    return (result.created.length === 4
      && result.skipped.length === 0
      && result.created[1].type === 'transform'
      && result.created[1].op === 'filter'
      && result.created[2].type === 'template'
      && result.created[2].templateId === 'std_check'
      && result.created[2].params != null
      && result.created[2].params.strict === true)
  } catch (e) {
    return false
  }
}
checks.push(['importConfig 正确创建 transform 与 template 节点（端到端，skipped 为空）', _checkImport()])

// template 缺省 params 填充默认值 {}（不透传成 undefined）
function _checkTemplateDefault() {
  if (vi == null) return false
  try {
    const result = vi.importConfig({
      nodes: [{ type: 'template', id: 'tpl2', templateId: 'basic' }],
    })
    return (result.created.length === 1
      && result.skipped.length === 0
      && result.created[0].type === 'template'
      && result.created[0].templateId === 'basic'
      && result.created[0].params != null
      && typeof result.created[0].params === 'object'
      && Object.keys(result.created[0].params).length === 0)
  } catch (e) {
    return false
  }
}
checks.push(["template 缺省 params 填充 {}（templateId 透传）", _checkTemplateDefault()])

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

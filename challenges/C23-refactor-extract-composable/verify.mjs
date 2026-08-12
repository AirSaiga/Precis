import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const W = join(__dirname, 'workspace')
const read = (p) => existsSync(p) ? readFileSync(p, 'utf-8') : ''
const checks = []

const useCounter = read(join(W, 'useCounter.js'))
const vue = read(join(W, 'Counter.vue'))
const seedVue = read(join(__dirname, 'seed', 'Counter.vue'))

// useCounter.js
checks.push(['useCounter.js 存在', existsSync(join(W, 'useCounter.js'))])
checks.push(['导出 useCounter 函数', /export\s+function\s+useCounter/.test(useCounter)])
checks.push(['useCounter import ref/computed from vue', /import\s+.*\bref\b.*from\s+['\"]vue['\"]/.test(useCounter) && /computed/.test(useCounter)])
checks.push(['useCounter 含 count = ref(0)', /count\s*=\s*ref\s*\(\s*0\s*\)/.test(useCounter)])
checks.push(['useCounter 含 double = computed', /double\s*=\s*computed/.test(useCounter)])
checks.push(['useCounter 含 increment 函数', /function\s+increment|increment\s*=/.test(useCounter)])
checks.push(['useCounter 含 decrement 函数', /function\s+decrement|decrement\s*=/.test(useCounter)])
checks.push(['useCounter 返回含 count/double/increment/decrement', /return\s*\{[\s\S]*count[\s\S]*double[\s\S]*increment[\s\S]*decrement/.test(useCounter)])

// Counter.vue
// import 检查允许跨行（`import {\n  useCounter\n} from './useCounter'` 也算）
checks.push(['Counter.vue import useCounter', /import\s+[\s\S]*?useCounter[\s\S]*?from/.test(vue)])
checks.push(['Counter.vue 解构 useCounter()', /const\s*\{[^}]*count[^}]*\}\s*=\s*useCounter\(\)/.test(vue)])
// 计数器逻辑已从 .vue 移除（不再直接定义 count = ref(0)）——对整个 vue 文本取反匹配。
// 已确认解构行 `const { count, ... } = useCounter()` 不匹配该正则：
// `count` 后面跟的是 `,` 而不是 `= ref(0)`。
checks.push(['Counter.vue 不再含 count = ref(0) 定义', !/count\s*=\s*ref\s*\(\s*0\s*\)/.test(vue)])
checks.push(['Counter.vue 不再含 double = computed', !/double\s*=\s*computed/.test(vue)])
// 模态框逻辑保留
checks.push(['Counter.vue 仍含 isVisible', /isVisible/.test(vue)])
checks.push(['Counter.vue 仍含 openModal/closeModal', /openModal/.test(vue) && /closeModal/.test(vue)])
checks.push(['Counter.vue 仍含 defineExpose', /defineExpose/.test(vue)])
// template 不可改：与 seed 的 <template>...</template> 段逐字比对
//（比对前把 CRLF 归一成 LF：编辑器/工具链的行尾转换不算改 template，其余任何字符差异都判 FAIL）
const extractTemplate = (s) => {
  const m = s.match(/<template>[\s\S]*<\/template>/)
  return m ? m[0].replace(/\r\n/g, '\n') : ''
}
const vueTpl = extractTemplate(vue)
const seedTpl = extractTemplate(seedVue)
checks.push(['<template> 与 seed 逐字一致（不可改）', seedTpl !== '' && vueTpl === seedTpl])

const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
process.exit(okAll ? 0 : 1)

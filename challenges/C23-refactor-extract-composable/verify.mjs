import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const W = join(__dirname, 'workspace')
const read = (p) => existsSync(p) ? readFileSync(p, 'utf-8') : ''
const checks = []

const useCounter = read(join(W, 'useCounter.js'))
const vue = read(join(W, 'Counter.vue'))

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
checks.push(['Counter.vue import useCounter', /import\s+.*useCounter.*from/.test(vue)])
checks.push(['Counter.vue 解构 useCounter()', /const\s*\{[^}]*count[^}]*\}\s*=\s*useCounter\(\)/.test(vue)])
// 计数器逻辑已从 .vue 移除（不再直接定义 count = ref(0)）
// 注意：destructure 行 `const { count, ... } = useCounter()` 里有 count 但不是 `count = ref(0)`
checks.push(['Counter.vue 不再含 count = ref(0) 定义', !/count\s*=\s*ref\s*\(\s*0\s*\)/.test(vue.split('useCounter')[0] || vue)])
checks.push(['Counter.vue 不再含 double = computed', !/double\s*=\s*computed/.test(vue)])
// 模态框逻辑保留
checks.push(['Counter.vue 仍含 isVisible', /isVisible/.test(vue)])
checks.push(['Counter.vue 仍含 openModal/closeModal', /openModal/.test(vue) && /closeModal/.test(vue)])
checks.push(['Counter.vue 仍含 defineExpose', /defineExpose/.test(vue)])
// template 未改
checks.push(['template 仍含 count 显示', /\{\{\s*count\s*\}\}/.test(vue) || /count/.test(vue.split('<template>')[1] || '')])

const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
process.exit(okAll ? 0 : 1)

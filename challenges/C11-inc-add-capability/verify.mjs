// verify.mjs — C11-inc-add-capability
//
// 验证 clipboardApi 能力已按 shellApi 模式落地：
//   clipboardApi.ts = interface + Electron 适配器 + Web 适配器 + 单例
//   component.ts    = 新增 renderCopyButton 消费 clipboardApi（保留 renderOpenButton）
//
// 纯静态：只读 workspace 内 2 个 .ts 源文件的文本做正则匹配，
// 不跑 tsc、不执行 agent 代码（.ts 也无法被 node 直接 require）。
// 因此无需 _safe_import / 输出捕获等防作弊包装——agent 没有执行入口可注入信号。
//
// 退出码：0 = PASS，非 0 = FAIL。
// stdout 首行：PASS 或 FAIL。后续行：`  [✓] / [✗] 描述`。

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const W = join(__dirname, 'workspace')
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf-8') : '')

const checks = []

const clip = read(join(W, 'clipboardApi.ts'))
const comp = read(join(W, 'component.ts'))

// ── clipboardApi.ts 结构 ────────────────────────────────────────────
checks.push(['clipboardApi.ts 存在', existsSync(join(W, 'clipboardApi.ts'))])
checks.push(['含 ClipboardApi interface', /interface\s+ClipboardApi/.test(clip)])
checks.push([
  'ClipboardApi 含 canWriteClipboard 只读属性',
  /readonly\s+canWriteClipboard\s*:\s*boolean/.test(clip),
])
checks.push(['ClipboardApi 含 writeText 方法', /writeText\s*\(/.test(clip)])
checks.push(['含 ElectronClipboardAdapter 类', /class\s+ElectronClipboardAdapter/.test(clip)])
checks.push([
  'ElectronClipboardAdapter canWriteClipboard=true',
  /ElectronClipboardAdapter[\s\S]*?canWriteClipboard\s*=\s*true/.test(clip),
])
checks.push(['含 WebClipboardAdapter 类', /class\s+WebClipboardAdapter/.test(clip)])

// WebClipboardAdapter 的 canWriteClipboard 必须是「计算值」：
// 关键决策——浏览器不一定有 navigator.clipboard（非安全上下文 / 旧浏览器），
// 故不能硬编码 true/false，必须引用 navigator 实际探测。
//
// 提取 WebClipboardAdapter 类体（到下一个顶层 class/function/export 或文件尾），
// 要求：(a) 类体内声明了 canWriteClipboard；(b) 类体内出现 navigator；
//       (c) canWriteClipboard 不是裸 true/false 字面量。
//
// 旧版用 `canWriteClipboard\s*=\s*[^t]` 抓「非 true」，但 `typeof navigator...`
// 的首字母正是 t，会把正确答案误判为 FAIL——故改用类体提取 + navigator 探测。
const webClassMatch = clip.match(/class\s+WebClipboardAdapter([\s\S]*?)(?:\n(?:class|function|export)\s|$)/)
const webBody = webClassMatch ? webClassMatch[1] : ''
checks.push([
  'WebClipboardAdapter canWriteClipboard 是计算值（引用 navigator，非硬编码 true/false）',
  /canWriteClipboard\s*=/.test(webBody) &&
    /navigator/.test(webBody) &&
    !/canWriteClipboard\s*=\s*(?:true|false)\b/.test(webBody),
])
checks.push([
  '导出 clipboardApi 单例（三元选适配器）',
  /export\s+const\s+clipboardApi[\s\S]*?isElectron\(\)[\s\S]*?new\s+ElectronClipboardAdapter[\s\S]*?new\s+WebClipboardAdapter/.test(
    clip,
  ),
])

// ── component.ts 消费 ───────────────────────────────────────────────
checks.push(['component.ts import clipboardApi', /import\s+.*clipboardApi.*from/.test(comp)])
checks.push(['component.ts 含 renderCopyButton 函数', /export\s+function\s+renderCopyButton/.test(comp)])
checks.push([
  'renderCopyButton 用 clipboardApi.canWriteClipboard 控制显隐',
  /renderCopyButton[\s\S]*?clipboardApi\.canWriteClipboard/.test(comp),
])
checks.push([
  'renderCopyButton onClick 调 clipboardApi.writeText',
  /renderCopyButton[\s\S]*?clipboardApi\.writeText/.test(comp),
])
checks.push(['renderOpenButton 仍存在（未删除）', /export\s+function\s+renderOpenButton/.test(comp)])

// ── 输出 ────────────────────────────────────────────────────────────
const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

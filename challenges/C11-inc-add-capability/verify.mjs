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

// 提取所有 class 体（名无关，用于按行为判定 Electron/Web 适配器）。
// 每个 class 从 'class Name' 到下一个 class 声明或文件尾。
const classStarts = [...clip.matchAll(/\bclass\s+(\w+)/g)]
const classSpans = classStarts.map((m, i) => {
  const start = m.index
  const end = i + 1 < classStarts.length ? classStarts[i + 1].index : clip.length
  return { name: m[1], text: clip.slice(start, end) }
})

// ── clipboardApi.ts 结构（契约名 + 模式，不锁死适配器类名） ─────────
checks.push(['clipboardApi.ts 存在', existsSync(join(W, 'clipboardApi.ts'))])
checks.push(['含 ClipboardApi interface', /interface\s+ClipboardApi/.test(clip)])
checks.push([
  'ClipboardApi 含 canWriteClipboard 只读属性',
  /readonly\s+canWriteClipboard\s*:\s*boolean/.test(clip),
])
checks.push(['ClipboardApi 含 writeText 方法', /writeText\s*\(/.test(clip)])

// 至少 2 个适配器类（Electron + Web 两套环境实现）
checks.push(['至少 2 个适配器类（Electron + Web）', classSpans.length >= 2])

// Electron 适配器：引用 window.electronAPI（原生剪贴板）+ canWriteClipboard 硬编码 true
const electronAdapter = classSpans.find((s) => /window\.electronAPI/.test(s.text))
checks.push([
  'Electron 适配器引用 window.electronAPI',
  electronAdapter !== undefined,
])
checks.push([
  'Electron 适配器 canWriteClipboard 硬编码 true',
  /canWriteClipboard\s*=\s*true/.test(clip),
])

// Web 适配器：canWriteClipboard 必须是计算值（引用 navigator，非硬编码 true/false）。
// 关键决策——浏览器不一定有 navigator.clipboard（非安全上下文 / 旧浏览器），
// 故不能硬编码 true/false，必须引用 navigator 实际探测。
const webAdapterOk = classSpans.some(
  (s) =>
    /canWriteClipboard\s*=/.test(s.text) &&
    /navigator/.test(s.text) &&
    !/canWriteClipboard\s*=\s*(?:true|false)\b/.test(s.text),
)
checks.push([
  'Web 适配器 canWriteClipboard 是计算值（引用 navigator，非硬编码 true/false）',
  webAdapterOk,
])

// 导出 clipboardApi 单例：isElectron() 三元选两个适配器实例（不锁死类名）
checks.push([
  '导出 clipboardApi 单例（isElectron 三元选两个适配器）',
  /export\s+const\s+clipboardApi[\s\S]*?isElectron\(\)[\s\S]*?new\s+\w+[\s\S]*?new\s+\w+/.test(
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

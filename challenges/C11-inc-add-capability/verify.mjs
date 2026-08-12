// verify.mjs — C11-inc-add-capability
//
// 验证 clipboardApi 能力已按 shellApi 模式落地，且满足两个串联规格：
//   clipboardApi.ts = interface + Electron 适配器 + Web 适配器
//                     + 可变单例持有位（let + isElectron 三元）
//                     + getClipboardApi / setClipboardApi 注入入口（操作同一持有位）
//   component.ts    = 新增 renderCopyButton 消费 clipboardApi（保留 renderOpenButton）
//                     能力缺失时 disabled（禁用），不是 show:false（隐藏）
//                     onClick 点击当下经 getClipboardApi() 解析实例再调 writeText
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
// 类字段写法两种都合规：`readonly canWriteClipboard = true` 与带类型注解的
// `readonly canWriteClipboard: boolean = true`（(?::\s*\w+)? 容忍两者）。
const electronAdapter = classSpans.find((s) => /window\.electronAPI/.test(s.text))
checks.push([
  'Electron 适配器引用 window.electronAPI',
  electronAdapter !== undefined,
])
checks.push([
  'Electron 适配器 canWriteClipboard 硬编码 true',
  /canWriteClipboard\s*(?::\s*\w+)?\s*=\s*true/.test(clip),
])

// Web 适配器：canWriteClipboard 必须是计算值（引用 navigator，非硬编码 true/false）。
// 关键决策——浏览器不一定有 navigator.clipboard（非安全上下文 / 旧浏览器），
// 故不能硬编码 true/false，必须引用 navigator 实际探测。
const webAdapterOk = classSpans.some(
  (s) =>
    /canWriteClipboard\s*(?::\s*\w+)?\s*=/.test(s.text) &&
    /navigator/.test(s.text) &&
    !/canWriteClipboard\s*(?::\s*\w+)?\s*=\s*(?:true|false)\b/.test(s.text),
)
checks.push([
  'Web 适配器 canWriteClipboard 是计算值（引用 navigator，非硬编码 true/false）',
  webAdapterOk,
])

// 可变单例持有位：let 声明 + isElectron() 三元选两个适配器实例。
// 与 shellApi 的 export const 不同——单例必须可替换（setClipboardApi 要能写它），
// 所以不能是 const。从这里捕获持有位变量名，供下面 set/get 一致性检查复用。
const singletonM = clip.match(
  /let\s+(\w+)(?:\s*:\s*\w+)?\s*=\s*isElectron\(\)\s*\?[\s\S]{0,200}?new\s+\w+[\s\S]{0,200}?new\s+\w+/,
)
const holder = singletonM ? singletonM[1] : null
checks.push([
  '可变单例持有位（let + isElectron 三元选两个适配器实例）',
  holder != null,
])

// 可注入 API 面：getClipboardApi / setClipboardApi 两个导出函数。
// 兼容 function 声明与 arrow const 两种导出形式。
const getIdx = clip.search(
  /export\s+(?:function\s+getClipboardApi|const\s+getClipboardApi\b)/,
)
const setIdx = clip.search(
  /export\s+(?:function\s+setClipboardApi|const\s+setClipboardApi\b)/,
)
checks.push(['导出 getClipboardApi（注入入口：读当前实例）', getIdx >= 0])
checks.push([
  '导出 setClipboardApi(api: ClipboardApi)（注入入口：替换当前实例）',
  /export\s+function\s+setClipboardApi\s*\(\s*\w+\s*:\s*ClipboardApi/.test(clip) ||
    /export\s+const\s+setClipboardApi\s*=\s*\(\s*\w+\s*:\s*ClipboardApi/.test(clip),
])

// set/get 必须操作同一个持有位（否则注入不进去 / 读出来的不是注入的实例）：
// setClipboardApi 体内有 `holder = <参数>` 赋值；getClipboardApi 体内 `return holder`
// （arrow 简写体 `=> holder` 也算）。
const setWin = setIdx >= 0 ? clip.slice(setIdx, setIdx + 500) : ''
const getWin = getIdx >= 0 ? clip.slice(getIdx, getIdx + 500) : ''
const setAssignsHolder =
  holder != null && new RegExp(`\\b${holder}\\s*=\\s*\\w+`).test(setWin)
const getReturnsHolder =
  holder != null && new RegExp(`(?:return\\s+|=>\\s*)${holder}\\b`).test(getWin)
checks.push([
  'set/get 操作同一持有位（set 赋值它、get 返回它）',
  setAssignsHolder && getReturnsHolder,
])

// ── component.ts 消费 ───────────────────────────────────────────────
// 提取 renderCopyButton 函数体窗口（到下一个 export 或文件尾），
// 只在窗口内断言，防止把 renderOpenButton 的代码算进来。
const rcIdx = comp.search(/export\s+function\s+renderCopyButton/)
let rcBody = ''
if (rcIdx >= 0) {
  const nextExport = comp.indexOf('\nexport', rcIdx + 10)
  rcBody = comp.slice(rcIdx, nextExport < 0 ? comp.length : nextExport)
}

// 消费方必须经 getClipboardApi() 解析实例——import 裸单例会让 setClipboardApi
// 的注入对消费方不可见（语义上 ESM live binding 可见，但题目规格要求走 get 入口）。
checks.push([
  "component.ts import getClipboardApi（from './clipboardApi'）",
  /import\s*\{[^}]*\bgetClipboardApi\b[^}]*\}\s*from\s*['"]\.\/clipboardApi['"]/.test(
    comp,
  ),
])
checks.push([
  'component.ts 含 renderCopyButton 函数',
  rcIdx >= 0,
])

// 剥离注释后再做函数体内的语义判定：注释里出现 "show:" 字样（如
// `// 不要用 show: false 隐藏`）或提到 getClipboardApi()，不应误伤合规解。
const rcBodyNoComments = rcBody
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\r\n]*/g, '')

checks.push([
  'renderCopyButton 用 canWriteClipboard 控制 disabled（禁用而非隐藏）',
  /canWriteClipboard/.test(rcBodyNoComments) &&
    /disabled/.test(rcBodyNoComments) &&
    (/canWriteClipboard[\s\S]{0,160}?disabled/.test(rcBodyNoComments) ||
      /disabled[\s\S]{0,160}?canWriteClipboard/.test(rcBodyNoComments)) &&
    !/\bshow\s*:/.test(rcBodyNoComments),
])

// onClick 点击当下经 getClipboardApi() 解析实例再调 writeText。
// 兼容两种合规写法：
//   (a) 直接链式：onClick: () => getClipboardApi().writeText(text)
//   (b) 局部变量中转：onClick: () => { const api = getClipboardApi(); api.writeText(text) }
// 注意：函数签名返回类型里也含 `onClick: () => void` 字样，故对每个 onClick
// 出现点的 300 字符窗口逐一断言（签名出现点的窗口会被函数体满足；真正的
// handler 出现点若走 render 时缓存实例 `onClick: () => api.writeText(...)`，
// 其窗口内没有 getClipboardApi() → 拦下）。
const onClickIdxs = [...rcBodyNoComments.matchAll(/onClick/g)].map((m) => m.index)
const onClickOk =
  onClickIdxs.length > 0 &&
  onClickIdxs.every((idx) => {
    const win = rcBodyNoComments.slice(idx, idx + 300)
    return /getClipboardApi\(\)/.test(win) && /\.writeText\s*\(/.test(win)
  })
checks.push([
  'renderCopyButton onClick 点击当下经 getClipboardApi() 解析再调 writeText',
  onClickOk,
])
checks.push(['renderOpenButton 仍存在（未删除）', /export\s+function\s+renderOpenButton/.test(comp)])

// ── 输出 ────────────────────────────────────────────────────────────
const okAll = checks.every(([, ok]) => ok)
console.log(okAll ? 'PASS' : 'FAIL')
for (const [desc, ok] of checks) {
  console.log(`  [${ok ? '✓' : '✗'}] ${desc}`)
}
process.exit(okAll ? 0 : 1)

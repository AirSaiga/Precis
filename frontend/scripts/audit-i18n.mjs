/**
 * @file audit-i18n.mjs
 * @description i18n key 完整性守卫（缺失 / 未用 key 检测）
 *
 * 形态对齐 audit-hardcoded-styles.mjs：支持 allowlist，发现违规时 process.exit(1)，
 * 供 lint:check / CI 调用。唯一外部依赖为 esbuild（已是 devDependency）——用它把
 * locale .ts 转 JS 后动态导入，避免手写脆弱的 TS 语法/字符串解析。
 *
 * 双报告：
 *   - 缺失 key：代码里 t('...') 引用了，但 locale 树里没有定义
 *   - 未用 key：locale 树里定义了，但代码里没有任何引用（动态前缀经 allowlist 豁免）
 *   - 不对称：仅一侧语言包存在的 key
 *
 * 用法：
 *   node ./scripts/audit-i18n.mjs
 *
 * allowlist（i18n-audit-exceptions.json）：
 *   {
 *     "dynamicPrefixes": ["inspection.severity.", "constraints.constraintTypes."],
 *     "baselineMissing": [...],   // 已知存量缺失 key（治理前快照），不阻断 CI
 *     "baselineOnlyZh": [...],
 *     "baselineOnlyEn": [...]
 *   }
 *   - dynamicPrefixes: 代码用 t(`prefix.${var}`) 动态拼接的命名空间前缀，
 *     其下叶子 key 不计入"未用"误报；同时 prefix 本身视为合法引用。
 *   - baseline*: 治理前的存量快照。守卫对"超出 baseline 的新增违规"判定失败，
 *     便于在不被存量阻塞的前提下防止回潮。修复存量后从 baseline 移除即可收紧。
 *   - 用 --update-baseline 运行可把当前 missing/onlyZh/onlyEn 写回 baseline。
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const projectRoot = path.resolve(import.meta.dirname, '..')
const srcRoot = path.join(projectRoot, 'src')
const localesRoot = path.join(srcRoot, 'i18n', 'locales')
const configPath = path.join(projectRoot, 'i18n-audit-exceptions.json')
const tmpDir = path.join(projectRoot, 'node_modules', '.i18n-audit-tmp')
const updateBaseline = process.argv.includes('--update-baseline')

// ─── allowlist ──────────────────────────────────────────────────────────────
function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return { dynamicPrefixes: [], baselineMissing: [], baselineOnlyZh: [], baselineOnlyEn: [] }
  }
}
const config = loadConfig()
const dynamicPrefixes = config.dynamicPrefixes ?? []
const baselineMissing = new Set(config.baselineMissing ?? [])
const baselineOnlyZh = new Set(config.baselineOnlyZh ?? [])
const baselineOnlyEn = new Set(config.baselineOnlyEn ?? [])

// ─── 文件遍历 ─────────────────────────────────────────────────────────────────
function walk(directoryPath, extensions) {
  const extSet = new Set(extensions)
  const files = []
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const fullPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, extensions))
    } else if (extSet.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }
  return files
}

// ─── 从代码中提取被引用的 key ──────────────────────────────────────────────────
// 匹配 t('key') / t("key") / $t('key') / i18n.global.t('key')，key 为静态字面量。
// 模板字面量 t(`key`) 仅当不含 ${} 时按静态处理；含 ${} 视为动态（由 allowlist 兜底）。
const staticKeyRegex = /\b(?:i18n\.global\.)?\$?t\(\s*(['"])([A-Za-z0-9_.]+)\1/g
const templateKeyRegex = /\b(?:i18n\.global\.)?\$?t\(\s*`([^`]+)`\)/g
// 动态前缀引用本身（t(`prefix.${x}`) 的 prefix 部分）
const dynamicRefRegex = /\b(?:i18n\.global\.)?\$?t\(\s*`([A-Za-z0-9_.]+)\.\$\{/g

function extractUsedKeys(content) {
  const used = new Set()
  for (const match of content.matchAll(staticKeyRegex)) used.add(match[2])
  for (const match of content.matchAll(templateKeyRegex)) {
    const raw = match[1]
    if (!raw.includes('${')) used.add(raw)
  }
  for (const match of content.matchAll(dynamicRefRegex)) used.add(`${match[1]}.`)
  return used
}

// ─── 从 locale 文件构建 key 树（esbuild transform + 动态导入）──────────────────
// index.ts 把子模块聚合为顶层命名空间。default-export 文件（common/shortcuts/inspection/
// feedback/inspectorConstraints）需按注册名还原命名空间；inspectorConstraints 合并进 inspector。
const DEFAULT_EXPORT_NAMESPACE = {
  common: 'common',
  shortcuts: 'shortcuts',
  inspection: 'inspection',
  feedback: 'feedback',
  inspectorConstraints: 'inspector',
}

// 导入名称 → 顶层命名空间（来自 index.ts 的具名导入）。绝大部分与文件内 const 名一致，
// 个别（common 文件 import 名 commonLocales → 命名空间 common）由 default-export 映射兜底。
function collectLeafKeys(obj, prefix, acc) {
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const dotted = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      collectLeafKeys(v, dotted, acc)
    } else {
      acc.add(dotted)
    }
  }
}

async function loadLocaleModule(tsFile) {
  // esbuild bundle：把 .ts（含相对 import，如 inspector.ts → inspectorConstraints）
  // 解析并内联为单文件 ESM，落临时文件后动态导入，拿到全部命名导出 + default 导出
  const fileBase = path.basename(tsFile, '.ts')
  const result = await build({
    entryPoints: [tsFile],
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'silent',
  })
  const js = result.outputFiles[0].text
  const tmpFile = path.join(tmpDir, `${fileBase}.mjs`)
  writeFileSync(tmpFile, js, 'utf8')
  const mod = await import(`${pathToFileURL(tmpFile).href}?t=${Date.now()}`)
  return { mod, fileBase }
}

async function buildLocaleKeys(localeDir) {
  mkdirSync(tmpDir, { recursive: true })
  const files = walk(localeDir, ['.ts']).filter((f) => !f.endsWith('index.ts'))
  const keys = new Set()
  for (const f of files) {
    const { mod, fileBase } = await loadLocaleModule(f)
    // 收集所有命名导出（const X = {...}）+ default 导出
    for (const [exportName, value] of Object.entries(mod)) {
      if (exportName === 'default') {
        const ns = DEFAULT_EXPORT_NAMESPACE[fileBase] ?? ''
        if (value && typeof value === 'object') collectLeafKeys(value, ns, keys)
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        collectLeafKeys(value, exportName, keys)
      }
    }
  }
  return keys
}

// ─── 比对 ──────────────────────────────────────────────────────────────────────
function isCoveredByDynamicPrefix(key) {
  return dynamicPrefixes.some((p) => key.startsWith(p))
}

// ─── 主流程 ────────────────────────────────────────────────────────────────────
const sourceFiles = walk(srcRoot, ['.ts', '.vue']).filter(
  (f) => !f.includes(path.join('i18n', 'locales')) && !f.includes(path.join('i18n', 'utils'))
)

const usedKeys = new Set()
for (const f of sourceFiles) {
  const content = readFileSync(f, 'utf8')
  for (const k of extractUsedKeys(content)) usedKeys.add(k)
}

const zhKeys = await buildLocaleKeys(path.join(localesRoot, 'zh-CN'))
const enKeys = await buildLocaleKeys(path.join(localesRoot, 'en-US'))

// 缺失：代码引用但两侧都没有
const missing = [...usedKeys]
  .filter((k) => !k.endsWith('.') && !zhKeys.has(k) && !enKeys.has(k))
  .filter((k) => !isCoveredByDynamicPrefix(k))
  .sort()

// 两侧不对称
const onlyZh = [...zhKeys].filter((k) => !enKeys.has(k)).sort()
const onlyEn = [...enKeys].filter((k) => !zhKeys.has(k)).sort()

// ─── baseline 模式：把当前存量写回 allowlist ─────────────────────────────────
if (updateBaseline) {
  const updated = {
    ...config,
    dynamicPrefixes,
    baselineMissing: missing,
    baselineOnlyZh: onlyZh,
    baselineOnlyEn: onlyEn,
  }
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
  console.log('✅ baseline 已更新并写入 i18n-audit-exceptions.json')
  console.log(`   missing: ${missing.length}，onlyZh: ${onlyZh.length}，onlyEn: ${onlyEn.length}`)
  process.exit(0)
}

// ─── 输出（仅"超出 baseline 的新增违规"判定失败）────────────────────────────────
// baseline 内的存量会被列出但标 [baseline]，不计入失败；新增项标 [new] 并计入失败。
const newMissing = missing.filter((k) => !baselineMissing.has(k))
const newOnlyZh = onlyZh.filter((k) => !baselineOnlyZh.has(k))
const newOnlyEn = onlyEn.filter((k) => !baselineOnlyEn.has(k))

let failed = false

if (missing.length > 0) {
  if (newMissing.length > 0) failed = true
  console.error(`\n❌ 缺失 key（代码引用但 zh-CN/en-US 均未定义，${missing.length} 个）：`)
  for (const k of missing) console.error(`   ${baselineMissing.has(k) ? '[baseline]' : '[new]'}     ${k}`)
}

if (onlyZh.length > 0) {
  if (newOnlyZh.length > 0) failed = true
  console.error(`\n⚠️  仅 zh-CN 存在（en-US 缺失，${onlyZh.length} 个）：`)
  for (const k of onlyZh) console.error(`   ${baselineOnlyZh.has(k) ? '[baseline]' : '[new]'}     ${k}`)
}

if (onlyEn.length > 0) {
  if (newOnlyEn.length > 0) failed = true
  console.error(`\n⚠️  仅 en-US 存在（zh-CN 缺失，${onlyEn.length} 个）：`)
  for (const k of onlyEn) console.error(`   ${baselineOnlyEn.has(k) ? '[baseline]' : '[new]'}     ${k}`)
}

if (failed) {
  console.error('\ni18n key 完整性审查失败：检测到超出 baseline 的新增违规。')
  console.error('修复这些 key，或如属合理存量请运行 `npm run audit:i18n -- --update-baseline` 刷新快照。')
  process.exit(1)
}

console.log('i18n key 完整性审查通过。')
console.log(
  `引用 key: ${usedKeys.size}，zh-CN 叶子: ${zhKeys.size}，en-US 叶子: ${enKeys.size}`
)
console.log(
  `存量 baseline: missing ${missing.length}/${baselineMissing.size}，onlyZh ${onlyZh.length}/${baselineOnlyZh.size}，onlyEn ${onlyEn.length}/${baselineOnlyEn.size}`
)


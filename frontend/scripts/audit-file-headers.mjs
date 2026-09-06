import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// 文件头注释门禁（2026-09 规范审计 F3 采纳方案 B）：
// - .ts：前 20 行内须有 @fileoverview（JSDoc 文件头）
// - .vue：首个非空行须为 <!-- 开头的散文式文件头
// - 存量无头文件在 file-header-audit-exceptions.json 豁免（渐进收紧：补头后从清单移除）
// - tests/ 不在扫描范围；新文件不带头直接失败
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const srcRoot = path.join(projectRoot, 'src')
const configPath = path.join(projectRoot, 'file-header-audit-exceptions.json')

const updateBaseline = process.argv.includes('--update-baseline')

function walk(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
      continue
    }

    if (/\.vue$|\.ts$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

function getRelativePath(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/')
}

function hasFileHeader(relativePath, content) {
  if (relativePath.endsWith('.vue')) {
    const firstLine = content.split('\n').find((line) => line.trim() !== '') ?? ''
    return firstLine.trimStart().startsWith('<!--')
  }
  const head = content.split('\n').slice(0, 20).join('\n')
  return head.includes('@fileoverview')
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return { exceptions: [] }
  }
}

const exempted = new Set(loadConfig().exceptions ?? [])
const missing = []

for (const filePath of walk(srcRoot)) {
  const relativePath = getRelativePath(filePath)
  if (exempted.has(relativePath)) continue
  if (!hasFileHeader(relativePath, readFileSync(filePath, 'utf8'))) missing.push(relativePath)
}

if (updateBaseline) {
  const merged = [...new Set([...exempted, ...missing])].sort()
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        说明:
          '存量无文件头文件豁免清单（2026-09 audit:file-headers 引入时快照，渐进收紧）。新增文件不带头会直接失败；给清单内文件补头后应手动移除该条目。',
        exceptions: merged,
      },
      null,
      2
    )}\n`
  )
  console.log('文件头豁免清单已更新。')
  console.log(`清单条目: ${merged.length}（本次新增 ${missing.length}）`)
  process.exit(0)
}

// 收紧提示：清单内文件其实已带头，可从清单移除
let staleCount = 0
for (const relativePath of exempted) {
  const fullPath = path.join(projectRoot, relativePath)
  let content
  try {
    content = readFileSync(fullPath, 'utf8')
  } catch {
    continue
  }
  if (hasFileHeader(relativePath, content)) staleCount += 1
}

if (missing.length > 0) {
  console.error('文件头注释审查失败。')
  console.error(`缺文件头的文件: ${missing.length}，豁免存量: ${exempted.size}`)
  for (const relativePath of missing) console.error(`  ${relativePath}`)
  console.error('确属合理存量时可用 `npm run audit:headers -- --update-baseline` 写回豁免清单。')
  process.exit(1)
}

console.log('文件头注释审查通过。')
console.log(`豁免存量: ${exempted.size}${staleCount > 0 ? `（其中 ${staleCount} 个已带头，可从清单移除以收紧）` : ''}`)

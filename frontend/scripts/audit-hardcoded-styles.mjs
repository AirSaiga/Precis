import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const srcRoot = path.join(projectRoot, 'src')
const configPath = path.join(projectRoot, 'style-audit-exceptions.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))

const targetExtensions = new Set(['.vue', '.css'])
const rules = [
  {
    id: 'no-prefers-color-scheme',
    regex: /prefers-color-scheme/g,
  },
  {
    id: 'no-hardcoded-color',
    regex: /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|hsl\(/g,
  },
]

function walk(directoryPath) {
  const entries = readdirSync(directoryPath, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
      continue
    }

    if (targetExtensions.has(path.extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegExp(pattern) {
  const normalized = pattern.replace(/\\/g, '/')
  let regexSource = ''

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    const nextCharacter = normalized[index + 1]
    const thirdCharacter = normalized[index + 2]

    if (character === '*' && nextCharacter === '*' && thirdCharacter === '/') {
      regexSource += '(?:.*/)?'
      index += 2
      continue
    }

    if (character === '*' && nextCharacter === '*') {
      regexSource += '.*'
      index += 1
      continue
    }

    if (character === '*') {
      regexSource += '[^/]*'
      continue
    }

    regexSource += escapeRegex(character)
  }

  return new RegExp(`^${regexSource}$`)
}

function getRelativePath(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/')
}

function extractVueStyleContent(content) {
  const blocks = [...content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(
    (match) => match[1] ?? ''
  )
  const inlineStyles = [...content.matchAll(/\bstyle\s*=\s*["']([\s\S]*?)["']/g)].map(
    (match) => match[1] ?? ''
  )
  return [...blocks, ...inlineStyles].join('\n')
}

function getAuditContent(filePath, content) {
  return path.extname(filePath) === '.vue' ? extractVueStyleContent(content) : content
}

function getLineAndColumn(content, index) {
  const previousContent = content.slice(0, index)
  const lines = previousContent.split('\n')
  const line = lines.length
  const column = lines[lines.length - 1].length + 1
  return { line, column }
}

function isExcluded(relativePath) {
  return config.exceptions.find((entry) => globToRegExp(entry.pattern).test(relativePath))
}

function collectViolations(filePath) {
  const relativePath = getRelativePath(filePath)
  const excludedBy = isExcluded(relativePath)

  if (excludedBy) {
    return { relativePath, skipped: true, reason: excludedBy.reason, violations: [] }
  }

  const content = readFileSync(filePath, 'utf8')
  const auditContent = getAuditContent(filePath, content)
  const violations = []

  for (const rule of rules) {
    for (const match of auditContent.matchAll(rule.regex)) {
      const index = match.index ?? 0
      const { line, column } = getLineAndColumn(auditContent, index)
      const snippet = auditContent
        .slice(index, index + 80)
        .split('\n')[0]
        .trim()

      violations.push({
        rule: rule.id,
        line,
        column,
        snippet,
      })
    }
  }

  return { relativePath, skipped: false, violations }
}

const results = walk(srcRoot).map(collectViolations)
const scannedFiles = results.filter((item) => !item.skipped)
const skippedFiles = results.filter((item) => item.skipped)
const failedFiles = scannedFiles.filter((item) => item.violations.length > 0)

if (failedFiles.length > 0) {
  console.error('硬编码样式审查失败。')
  console.error(
    `扫描文件: ${scannedFiles.length}，迁移例外: ${skippedFiles.length}，失败文件: ${failedFiles.length}`
  )

  for (const file of failedFiles) {
    console.error(`\n${file.relativePath}`)

    for (const violation of file.violations) {
      console.error(
        `  [${violation.rule}] ${violation.line}:${violation.column} ${violation.snippet}`
      )
    }
  }

  process.exit(1)
}

console.log('硬编码样式审查通过。')
console.log(`扫描文件: ${scannedFiles.length}`)
console.log(`迁移例外: ${skippedFiles.length}`)
console.log(`例外清单: ${path.relative(projectRoot, configPath).split(path.sep).join('/')}`)

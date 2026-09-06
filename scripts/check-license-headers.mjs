#!/usr/bin/env node
/**
 * @fileoverview 全仓 Apache-2.0 license 头完整性守卫（2026-09 补齐批引入）
 *
 * 范围与 scripts/release.mjs 系一样走 git 清单；缺头文件列出并 exit 1，
 * 供 CI（ci.yml encoding-check job）与本地复验。幂等只读。
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')

const EXCLUDE_DIR_RE = /(^|\/)(node_modules|dist|dist-ssr|coverage|\.pytest_cache|target|\.venv|__pycache__|build|\.git)\\?\//
const EXCLUDE_FILE_RE = /(^|\/)generated\//
const INCLUDE_RE = [
  /^frontend\/(src|tests|scripts)\//,
  /^frontend\/[^/]+\.ts$/,
  /^frontend\/index\.html$/,
  /^backend\/.*\.py$/,
  /^electron\/src\/.*\.ts$/,
  /^tui-rust\/src\/.*\.rs$/,
  /^e2e\/.*\.ts$/,
]
const EXTS = /\.(ts|mts|mjs|vue|css|py|rs|html)$/

const files = execSync('git ls-files -co --exclude-standard', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((s) => s.replace(/\\/g, '/').trim())
  .filter(
    (f) =>
      f &&
      EXTS.test(f) &&
      !EXCLUDE_DIR_RE.test(f + '/') &&
      !EXCLUDE_FILE_RE.test(f) &&
      INCLUDE_RE.some((re) => re.test(f))
  )

const missing = []
for (const rel of files) {
  const head = readFileSync(path.join(root, rel), 'utf8')
    .split('\n')
    .slice(0, 15)
    .join('\n')
  if (!/SPDX-License-Identifier|Apache License/.test(head)) missing.push(rel)
}

if (missing.length > 0) {
  console.error(`License 头审查失败：${missing.length} 个文件缺 Apache-2.0 头（范围 ${files.length} 个）。`)
  for (const rel of missing) console.error(`  ${rel}`)
  process.exit(1)
}

console.log(`License 头审查通过。范围文件: ${files.length}，全部含 Apache-2.0 头。`)

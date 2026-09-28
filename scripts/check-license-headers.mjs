#!/usr/bin/env node
/**
 * @fileoverview 全仓 Apache-2.0 license 头完整性守卫（2026-09 补齐批引入）
 *
 * 范围与 scripts/release.mjs 系一样走 git 清单；缺头文件列出并 exit 1，
 * 供 CI（ci.yml encoding-check job）与本地复验。幂等只读。
 */
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(SCRIPT_PATH), '..')

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

/** 从 `git ls-files -co --exclude-standard` 输出筛出 license 头检查范围的仓库相对路径（纯函数，供测试）。 */
export function selectLicenseScopeFiles(gitLsFilesOutput) {
  return gitLsFilesOutput
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
}

/**
 * 逐文件读前 15 行检查 Apache-2.0 头，返回缺头相对路径列表（纯函数，供测试）。
 * git 仍跟踪但工作树已删除（未暂存 rm）的文件直接跳过——无内容可查，不构成缺头，也不因 ENOENT 崩溃。
 */
export function findMissingLicenseHeaders(relPaths, rootDir) {
  const missing = []
  for (const rel of relPaths) {
    const abs = path.join(rootDir, rel)
    if (!existsSync(abs)) continue
    const head = readFileSync(abs, 'utf8')
      .split('\n')
      .slice(0, 15)
      .join('\n')
    if (!/SPDX-License-Identifier|Apache License/.test(head)) missing.push(rel)
  }
  return missing
}

function main() {
  const files = selectLicenseScopeFiles(
    execSync('git ls-files -co --exclude-standard', { cwd: root, encoding: 'utf8' })
  )
  const missing = findMissingLicenseHeaders(files, root)

  if (missing.length > 0) {
    console.error(`License 头审查失败：${missing.length} 个文件缺 Apache-2.0 头（范围 ${files.length} 个）。`)
    for (const rel of missing) console.error(`  ${rel}`)
    process.exit(1)
  }

  console.log(`License 头审查通过。范围文件: ${files.length}，全部含 Apache-2.0 头。`)
}

// 直接执行时运行守卫；被 import（单元测试）时不执行
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main()
}

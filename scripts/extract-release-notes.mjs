#!/usr/bin/env node
/**
 * @fileoverview 从 CHANGELOG.md 提取指定版本分节，作为 GitHub Release body 输出到 stdout。
 *
 * 用法: node scripts/extract-release-notes.mjs <version> [--changelog <path>]
 *   - 找到 "## [<version>] - ..." 分节，输出到下一个 "## " 标题（或文件尾）为止的内容
 *   - 找不到分节时输出兜底文案（exit 0），避免阻断 CD
 *
 * 供 .github/workflows/cd.yml 的 release job 使用。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

/**
 * 提取 CHANGELOG 中指定版本的 markdown 分节（纯函数，供测试）。
 * @returns {string|null} 分节内容（trim 后）；不存在返回 null
 */
export function extractReleaseNotes(changelogContent, version) {
  const re = new RegExp(`^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][ \t]*.*$`, 'm');
  const start = re.exec(changelogContent);
  if (!start) return null;
  const after = changelogContent.slice(start.index + start[0].length);
  const nextH2 = /^## /m.exec(after);
  const section = nextH2 ? after.slice(0, nextH2.index) : after;
  return section.trim() || null;
}

function main() {
  const args = process.argv.slice(2);
  const version = args.find((a) => !a.startsWith('--'));
  const changelogIdx = args.indexOf('--changelog');
  const changelogPath = changelogIdx >= 0 ? path.resolve(args[changelogIdx + 1]) : path.join(ROOT, 'CHANGELOG.md');

  if (!version) {
    console.error('用法: node scripts/extract-release-notes.mjs <version> [--changelog <path>]');
    process.exit(2);
  }

  let content;
  try {
    content = fs.readFileSync(changelogPath, 'utf-8');
  } catch {
    console.error(`[extract-release-notes] 无法读取 CHANGELOG: ${changelogPath}`);
    process.stdout.write(`Precis v${version}\n\nRelease notes: see [CHANGELOG.md](https://github.com/AirSaiga/Precis/blob/main/CHANGELOG.md).`);
    return;
  }

  const section = extractReleaseNotes(content, version);
  if (!section) {
    console.error(`[extract-release-notes] CHANGELOG 中未找到 [${version}] 分节，使用兜底文案`);
    process.stdout.write(`Precis v${version}\n\nRelease notes: see [CHANGELOG.md](https://github.com/AirSaiga/Precis/blob/main/CHANGELOG.md).`);
    return;
  }
  process.stdout.write(section);
}

// 直接执行时运行 CLI；被 import（单元测试）时不执行
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main();
}

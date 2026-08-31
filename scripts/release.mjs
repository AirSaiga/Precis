#!/usr/bin/env node
/**
 * @fileoverview Precis 版本发布脚本 —— 单源版本同步 + CHANGELOG 切版 + tag 触发 CD
 *
 * 子命令:
 *   release <version|patch|minor|major> [--prerelease <suffix>] [--dry-run] [--no-push]
 *       一键发布：校验 → 同步六处版本 → CHANGELOG 切版 → commit → annotated tag → push（触发 CD）
 *   sync <version>
 *       仅同步版本到六处 manifest，不做 git 操作（CD workflow_dispatch 路径使用）
 *   check <version>
 *       校验六处 manifest 版本与期望值一致，不一致退出码非 0（CD 版本守卫 job 使用）
 *
 * 版本单一事实源（SSOT）: 根 package.json 的 version。
 * 同步副本: electron/package.json、frontend/package.json（经 npm version 连带各自 lock）+
 *           backend/pyproject.toml、tui-rust/Cargo.toml、tui-rust/Cargo.lock（precis-tui 包块）。
 *           npm 三处连带更新的 package-lock.json 也随发布提交入库（releaseCommitFiles），
 *           漏提交会残留脏工作树，把下一次发布挡在干净树检查上（v0.1.1 实证）。
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

/** 六处版本载体（npm 三处经 npm version 同步 lock，TOML 由本脚本正则替换） */
export const MANIFESTS = [
  { file: 'package.json', kind: 'npm' },
  { file: 'frontend/package.json', kind: 'npm' },
  { file: 'electron/package.json', kind: 'npm' },
  { file: 'backend/pyproject.toml', kind: 'pyproject' },
  { file: 'tui-rust/Cargo.toml', kind: 'cargo' },
  { file: 'tui-rust/Cargo.lock', kind: 'cargo-lock' },
];

/**
 * 发布提交应包含的文件：六处 manifest + 三份 package-lock.json + CHANGELOG。
 * npm version 更新 package.json 时会连带写各目录 lockfile 的版本字段；
 * 若不一并提交，发布后工作树残留未提交改动，下一次发布被干净树检查阻塞。
 */
export function releaseCommitFiles() {
  const lockfiles = MANIFESTS.filter((m) => m.kind === 'npm').map((m) => m.file.replace(/package\.json$/, 'package-lock.json'));
  return [...MANIFESTS.map((m) => m.file), ...lockfiles, 'CHANGELOG.md'];
}

// ============================================================================
// 纯函数（供 node --test 单元测试）
// ============================================================================

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** 校验 semver 字符串（宽松：允许 prerelease / build metadata） */
export function isValidSemver(v) {
  return typeof v === 'string' && SEMVER_RE.test(v);
}

/** 解析 semver 为可比较结构；非法则抛错 */
export function parseSemver(v) {
  const m = SEMVER_RE.exec(v ?? '');
  if (!m) throw new Error(`非法 semver 版本号: ${v}`);
  const prerelease = m[4] ? m[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease };
}

/**
 * 比较两个 semver：a<b 返回 -1，相等返回 0，a>b 返回 1。
 * prerelease 遵循 semver 规范：存在 prerelease 的版本低于同数字版本；
 * 数字段 < 字母段；短 prerelease 列表 < 长列表（前缀相同时）。
 */
export function compareSemver(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  const pa = va.prerelease;
  const pb = vb.prerelease;
  if (pa.length === 0 && pb.length === 0) return 0;
  // 无 prerelease > 有 prerelease
  if (pa.length === 0) return 1;
  if (pb.length === 0) return -1;
  const len = Math.min(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    const xNum = typeof x === 'number';
    const yNum = typeof y === 'number';
    if (xNum && yNum) return x < y ? -1 : 1;
    if (xNum) return -1; // 数字标识符恒低于字母标识符
    if (yNum) return 1;
    return x < y ? -1 : 1;
  }
  return pa.length < pb.length ? -1 : pa.length > pb.length ? 1 : 0;
}

/** 按 patch/minor/major 递增；当前带 prerelease 时同级别递增会先落回正式版（与 npm version 语义一致） */
export function bumpVersion(current, kind, prereleaseSuffix) {
  const v = parseSemver(current);
  if (v.prerelease.length > 0 && !prereleaseSuffix) {
    // 0.2.0-alpha.1 + patch/minor/major → 落回 0.2.0（如果 kind 匹配当前数字位）；
    // kind 高于当前位则正常递增。简化处理：一律先落正式版再按 kind 递增 patch，
    // 但 patch 落回同数字（0.2.0-alpha.1 + patch = 0.2.0，与 npm 一致）。
    const base = `${v.major}.${v.minor}.${v.patch}`;
    const b = parseSemver(base);
    if (kind === 'patch') return withSuffix(base, null);
    if (kind === 'minor') return withSuffix(`${b.major}.${b.minor + 1}.0`, null);
    return withSuffix(`${b.major + 1}.0.0`, null);
  }
  let next;
  if (kind === 'patch') next = `${v.major}.${v.minor}.${v.patch + 1}`;
  else if (kind === 'minor') next = `${v.major}.${v.minor + 1}.0`;
  else if (kind === 'major') next = `${v.major + 1}.0.0`;
  else throw new Error(`非法递增类型: ${kind}`);
  return withSuffix(next, prereleaseSuffix);
}

function withSuffix(base, suffix) {
  return suffix ? `${base}-${suffix}` : base;
}

/**
 * CHANGELOG 切版：把 [Unreleased] 下第一个 "### YYYY-MM" 月份分节起的内容落为
 * 新版本分节，顶部保留 [Unreleased] 及其说明性子节。
 *
 * @returns {{ updated: string, releasedSection: string, hadDatedContent: boolean }}
 *   releasedSection 为空串表示 Unreleased 下没有月份内容（发布空版本，调用方应警告）
 */
export function cutChangelog(content, version, dateStr) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const unreleasedMatch = /^## \[Unreleased\][ \t]*$/m.exec(content);
  if (!unreleasedMatch) throw new Error('CHANGELOG.md 缺少 "## [Unreleased]" 分节');
  const afterIdx = unreleasedMatch.index + unreleasedMatch[0].length;
  const after = content.slice(afterIdx);

  const dated = /^### \d{4}-\d{2}[ \t]*$/m.exec(after);
  const nextH2 = /^## /m.exec(after);

  let insertAt;
  let releasedSection = '';
  let hadDatedContent = false;
  if (dated && (!nextH2 || dated.index < nextH2.index)) {
    insertAt = afterIdx + dated.index;
    const sectionEnd = nextH2 ? afterIdx + nextH2.index : content.length;
    releasedSection = content.slice(insertAt, sectionEnd).trim();
    hadDatedContent = true;
  } else if (nextH2) {
    insertAt = afterIdx + nextH2.index;
  } else {
    insertAt = content.length;
  }

  const heading = `## [${version}] - ${dateStr}`;
  const insertion = `${heading}${eol}${eol}`;
  const updated = content.slice(0, insertAt) + insertion + content.slice(insertAt);
  return { updated, releasedSection, hadDatedContent };
}

/** 读取 TOML 中指定 [section] 之后的第一个 version 字段（pyproject [project] / Cargo [package]） */
export function readTomlSectionVersion(content, sectionHeader) {
  const re = new RegExp(`^\\[${sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][ \\t]*$`, 'm');
  const sec = re.exec(content);
  if (!sec) throw new Error(`TOML 缺少 [${sectionHeader}] 分节`);
  const after = content.slice(sec.index + sec[0].length);
  const ver = /^version[ \t]*=[ \t]*"([^"]+)"/m.exec(after);
  if (!ver) throw new Error(`[${sectionHeader}] 分节缺少 version 字段`);
  return ver[1];
}

/** 替换 TOML 指定分节后的第一个 version 字段，返回新内容 */
export function writeTomlSectionVersion(content, sectionHeader, version) {
  const re = new RegExp(
    `(^\\[${sectionHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][ \\t]*$[\\s\\S]*?^version[ \\t]*=[ \\t]*")([^"]+)(")`,
    'm',
  );
  if (!re.test(content)) throw new Error(`[${sectionHeader}] 分节缺少 version 字段，无法替换`);
  return content.replace(re, `$1${version}$3`);
}

/** 读取 Cargo.lock 中指定本地包（无 source/checksum 行）的 version */
export function readCargoLockVersion(content, packageName) {
  const re = new RegExp(`^\\[\\[package\\]\\][^\\n]*\\nname = "${packageName}"\\nversion = "([^"]+)"`, 'm');
  const m = re.exec(content);
  if (!m) throw new Error(`Cargo.lock 缺少 ${packageName} 包块`);
  return m[1];
}

/** 替换 Cargo.lock 中指定包块的 version（本地路径包无 checksum，仅改版本安全） */
export function writeCargoLockVersion(content, packageName, version) {
  const re = new RegExp(`(\\[\\[package\\]\\][^\\n]*\\nname = "${packageName}"\\nversion = ")([^"]+)(")`);
  if (!re.test(content)) throw new Error(`Cargo.lock 缺少 ${packageName} 包块，无法替换`);
  return content.replace(re, `$1${version}$3`);
}

/** 读取某一处 manifest 的版本号 */
export function readManifestVersion(manifest) {
  const filePath = path.join(ROOT, manifest.file);
  const content = fs.readFileSync(filePath, 'utf-8');
  switch (manifest.kind) {
    case 'npm':
      return JSON.parse(content).version;
    case 'pyproject':
      return readTomlSectionVersion(content, 'project');
    case 'cargo':
      return readTomlSectionVersion(content, 'package');
    case 'cargo-lock':
      return readCargoLockVersion(content, 'precis-tui');
    default:
      throw new Error(`未知 manifest 类型: ${manifest.kind}`);
  }
}

// ============================================================================
// git / npm 辅助
// ============================================================================

function git(args, opts = {}) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString().trim();
}

function run(cmd, cwd) {
  execSync(cmd, { cwd: path.join(ROOT, cwd ?? '.'), stdio: 'inherit' });
}

function localDateISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 取已有 v* tag 中的最高 semver（无则 null） */
export function latestVersionTag(tags) {
  const versions = (tags ?? []).filter((t) => isValidSemver(t.replace(/^v/, '')));
  if (versions.length === 0) return null;
  return versions.reduce((max, t) => (compareSemver(t.replace(/^v/, ''), max.replace(/^v/, '')) > 0 ? t : max));
}

// ============================================================================
// 子命令实现
// ============================================================================

function resolveNextVersion(spec, prereleaseSuffix) {
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;
  if (['patch', 'minor', 'major'].includes(spec)) {
    return bumpVersion(current, spec, prereleaseSuffix);
  }
  if (!isValidSemver(spec)) {
    throw new Error(`版本号非法（需为 semver 或 patch/minor/major）: ${spec}`);
  }
  if (prereleaseSuffix) {
    if (parseSemver(spec).prerelease.length > 0) {
      throw new Error(`--prerelease 与显式 prerelease 版本号不能同时使用: ${spec}`);
    }
    return withSuffix(spec, prereleaseSuffix);
  }
  return spec;
}

/** 同步六处 manifest（npm 三处走 npm version 连带 lockfile；TOML 三处正则替换） */
function syncAllManifests(version, { dryRun = false } = {}) {
  const changes = [];
  for (const manifest of MANIFESTS) {
    const filePath = path.join(ROOT, manifest.file);
    const before = readManifestVersion(manifest);
    if (before === version) {
      changes.push({ file: manifest.file, before, after: version, applied: 'skip（已一致）' });
      continue;
    }
    if (manifest.kind === 'npm') {
      if (dryRun) {
        changes.push({ file: manifest.file, before, after: version, applied: 'dry-run（将执行 npm version，连带 lockfile）' });
        continue;
      }
      run(`npm version ${version} --no-git-tag-version --allow-same-version`, path.dirname(manifest.file));
    } else {
      const content = fs.readFileSync(filePath, 'utf-8');
      const updated =
        manifest.kind === 'pyproject'
          ? writeTomlSectionVersion(content, 'project', version)
          : manifest.kind === 'cargo'
            ? writeTomlSectionVersion(content, 'package', version)
            : writeCargoLockVersion(content, 'precis-tui', version);
      if (!dryRun) fs.writeFileSync(filePath, updated, 'utf-8');
    }
    changes.push({ file: manifest.file, before, after: version, applied: dryRun ? 'dry-run' : 'done' });
  }
  return changes;
}

function printChanges(changes) {
  console.log('\n版本同步清单 / Version sync:');
  for (const c of changes) {
    const mark = c.before === c.after ? '=' : `${c.before} -> ${c.after}`;
    console.log(`  [${c.applied}] ${c.file}  (${mark})`);
  }
}

function cmdCheck(expected) {
  if (!isValidSemver(expected)) {
    console.error(`[release] 非法版本号: ${expected}`);
    process.exit(2);
  }
  let ok = true;
  console.log(`\n版本一致性校验 / Manifest version check（期望 ${expected}）:`);
  for (const manifest of MANIFESTS) {
    let actual;
    try {
      actual = readManifestVersion(manifest);
    } catch (err) {
      console.error(`  [FAIL] ${manifest.file}: ${err.message}`);
      ok = false;
      continue;
    }
    const pass = actual === expected;
    if (!pass) ok = false;
    console.log(`  [${pass ? ' OK ' : 'FAIL'}] ${manifest.file}: ${actual}`);
  }
  if (!ok) {
    console.error('\n[release] 版本不一致：tag 推送前请先运行 npm run release 同步全部 manifest');
    process.exit(1);
  }
  console.log('\n[release] 全部一致 ✓');
}

function cmdSync(version) {
  if (!isValidSemver(version)) {
    console.error(`[release] 非法版本号: ${version}`);
    process.exit(2);
  }
  const changes = syncAllManifests(version);
  printChanges(changes);
  console.log(`\n[release] sync 完成（未做任何 git 操作）`);
}

function cmdRelease({ spec, prereleaseSuffix, dryRun, noPush }) {
  const version = resolveNextVersion(spec, prereleaseSuffix);
  const tag = `v${version}`;

  // ---- 前置校验（dry-run 跳过 git 状态检查，便于在任意环境预览） ----
  const branch = git('rev-parse --abbrev-ref HEAD');
  if (!dryRun && branch !== 'main') {
    throw new Error(`当前分支为 ${branch}，发布只允许在 main 分支执行（或用 --dry-run 预览）`);
  }
  if (!dryRun && git('status --porcelain') !== '') {
    throw new Error('工作树不干净：请先提交或暂存所有改动后再发布');
  }
  if (git(`tag -l ${tag}`) !== '') {
    throw new Error(`tag ${tag} 已存在`);
  }
  // 注意：不在 shell 里用通配符（Windows cmd 不认单引号，glob 语义跨 shell 不一致），
  // 拉全量 tag 后在 JS 侧过滤 v 前缀 + semver 合法性
  const allTags = git('tag -l').split('\n').filter(Boolean).filter((t) => t.startsWith('v'));
  const latestTag = latestVersionTag(allTags);
  if (latestTag && compareSemver(version, latestTag.replace(/^v/, '')) <= 0) {
    throw new Error(`目标版本 ${version} 不高于最新 tag ${latestTag}，拒绝倒退发布`);
  }

  console.log(`[release] 目标版本: ${version}（tag ${tag}，基于分支 ${branch}）`);

  // ---- 同步六处 manifest ----
  const changes = syncAllManifests(version, { dryRun });
  printChanges(changes);

  // ---- CHANGELOG 切版 ----
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  const changelog = fs.readFileSync(changelogPath, 'utf-8');
  const { updated, releasedSection, hadDatedContent } = cutChangelog(changelog, version, localDateISO());
  if (!hadDatedContent) {
    console.warn('[release] 警告: [Unreleased] 下没有 "### YYYY-MM" 内容分节，将发布一个空 CHANGELOG 分节');
  }
  if (dryRun) {
    console.log('\nCHANGELOG 切版预览（新增标题 + 迁移内容行数）:');
    console.log(`  新增: ## [${version}] - ${localDateISO()}`);
    console.log(`  迁移内容: ${releasedSection ? releasedSection.split('\n').length + ' 行' : '（空）'}`);
    console.log('\n[release] --dry-run 完成，未写入任何文件、未执行 git 操作');
    return;
  }
  fs.writeFileSync(changelogPath, updated, 'utf-8');

  // ---- commit + tag + push ----
  const filesToCommit = releaseCommitFiles();
  git(`add ${filesToCommit.map((f) => `"${f}"`).join(' ')}`);
  git(`commit -m "chore(release): ${tag}"`);
  git(`tag -a ${tag} -m "Precis ${tag}"`);
  console.log(`\n[release] 已提交 chore(release): ${tag} 并打 annotated tag`);

  if (noPush) {
    console.log('[release] --no-push：请手动执行以下命令触发 CD：');
    console.log(`  git push origin main --follow-tags`);
  } else {
    run('git push origin main --follow-tags', '.');
    console.log('\n[release] 已推送，CD 将自动构建并发布 GitHub Release:');
    console.log(`  https://github.com/AirSaiga/Precis/actions`);
    console.log(`  https://github.com/AirSaiga/Precis/releases/tag/${tag}`);
    console.log('\n回滚指引（发布后发现问题时）: git tag -d ${tag} && git push origin :refs/tags/${tag}，并在 GitHub 删除对应 Release');
  }
}

// ============================================================================
// CLI 入口
// ============================================================================

function parseArgs(argv) {
  const args = { command: 'help', spec: null, prereleaseSuffix: null, dryRun: false, noPush: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-push') args.noPush = true;
    else if (a === '--prerelease') args.prereleaseSuffix = argv[++i];
    else if (a === '--prerelease=') args.prereleaseSuffix = '';
    else if (a.startsWith('--prerelease=')) args.prereleaseSuffix = a.slice('--prerelease='.length);
    else if (a === '-h' || a === '--help') return args;
    else positional.push(a);
  }
  if (positional.length === 0) return args;
  if (['sync', 'check', 'help'].includes(positional[0])) {
    args.command = positional[0];
    args.spec = positional[1] ?? null;
  } else {
    args.command = 'release';
    args.spec = positional[0];
  }
  return args;
}

function printHelp() {
  console.log(`Precis 版本发布脚本

用法:
  npm run release -- <version|patch|minor|major> [--prerelease alpha.1] [--dry-run] [--no-push]
      一键发布: 校验 → 同步六处版本 → CHANGELOG 切版 → commit → tag → push 触发 CD
  npm run release -- sync <version>
      仅同步版本到六处 manifest（CD workflow_dispatch 用）
  npm run release -- check <version>
      校验六处 manifest 版本一致（CD 守卫用）

示例:
  npm run release -- 0.1.1 --dry-run     # 预览 0.1.1 的全部改动
  npm run release -- patch               # 0.1.0 -> 0.1.1
  npm run release -- minor --prerelease alpha.1   # 0.1.0 -> 0.2.0-alpha.1`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.command === 'help' || !args.spec) {
      printHelp();
      process.exit(args.command === 'help' ? 0 : 2);
    }
    if (args.command === 'check') cmdCheck(args.spec);
    else if (args.command === 'sync') cmdSync(args.spec);
    else cmdRelease(args);
  } catch (err) {
    console.error(`\n[release] 失败: ${err.message}`);
    process.exit(1);
  }
}

// 直接执行时运行 CLI；被 import（单元测试）时不执行
if (process.argv[1] && pathToFileURL(process.argv[1]).href === pathToFileURL(SCRIPT_PATH).href) {
  main();
}

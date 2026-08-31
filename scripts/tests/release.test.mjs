/**
 * release.mjs 纯函数单元测试（node --test）
 *
 * 运行: npm run test:scripts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSemver,
  compareSemver,
  bumpVersion,
  cutChangelog,
  readTomlSectionVersion,
  writeTomlSectionVersion,
  readCargoLockVersion,
  writeCargoLockVersion,
  latestVersionTag,
  releaseCommitFiles,
} from '../release.mjs';

// ---------------------------------------------------------------------------
// semver 校验与比较
// ---------------------------------------------------------------------------

test('isValidSemver 接受合法版本并拒绝非法版本', () => {
  assert.equal(isValidSemver('0.1.0'), true);
  assert.equal(isValidSemver('1.2.3-alpha.1'), true);
  assert.equal(isValidSemver('1.2.3-alpha.1+build.5'), true);
  assert.equal(isValidSemver('v0.1.0'), false);
  assert.equal(isValidSemver('0.1'), false);
  assert.equal(isValidSemver('0.1.0.0'), false);
  assert.equal(isValidSemver(''), false);
  assert.equal(isValidSemver(null), false);
});

test('compareSemver 按数字位比较', () => {
  assert.equal(compareSemver('0.1.0', '0.1.1'), -1);
  assert.equal(compareSemver('0.2.0', '0.1.99'), 1);
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.equal(compareSemver('10.0.0', '9.0.0'), 1);
});

test('compareSemver prerelease 低于同数字正式版', () => {
  assert.equal(compareSemver('0.2.0-alpha.1', '0.2.0'), -1);
  assert.equal(compareSemver('0.2.0', '0.2.0-alpha.1'), 1);
  assert.equal(compareSemver('0.2.0-alpha.1', '0.2.0-alpha.2'), -1);
  // semver 规范：数字标识符恒低于字母标识符
  assert.equal(compareSemver('0.2.0-alpha.1', '0.2.0-alpha.beta'), -1);
  // 前缀相同时短列表低
  assert.equal(compareSemver('0.2.0-alpha', '0.2.0-alpha.1'), -1);
});

// ---------------------------------------------------------------------------
// bumpVersion
// ---------------------------------------------------------------------------

test('bumpVersion 常规递增', () => {
  assert.equal(bumpVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(bumpVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(bumpVersion('0.9.9', 'major'), '1.0.0');
  assert.equal(bumpVersion('0.1.0', 'minor', 'alpha.1'), '0.2.0-alpha.1');
});

test('bumpVersion 对 prerelease 当前版本先落回正式版（与 npm version 语义一致）', () => {
  assert.equal(bumpVersion('0.2.0-alpha.1', 'patch'), '0.2.0');
  assert.equal(bumpVersion('0.2.0-alpha.1', 'minor'), '0.3.0');
  assert.equal(bumpVersion('0.2.0-alpha.1', 'major'), '1.0.0');
});

// ---------------------------------------------------------------------------
// CHANGELOG 切版
// ---------------------------------------------------------------------------

const SAMPLE_CHANGELOG = [
  '# 变更日志 / Changelog',
  '',
  '> Alpha 免责声明。',
  '',
  '## [Unreleased]',
  '',
  '### 说明 / Note',
  '',
  '活跃开发中原型。',
  '',
  '### 2026-08',
  '',
  '- 新功能甲',
  '',
  '  Feature A',
  '',
  '### 2026-07',
  '',
  '- 新功能乙',
  '',
  '  Feature B',
  '',
].join('\n');

test('cutChangelog 把月份分节落为新版本分节并保留 Unreleased 说明', () => {
  const { updated, releasedSection, hadDatedContent } = cutChangelog(SAMPLE_CHANGELOG, '0.1.1', '2026-08-30');

  assert.equal(hadDatedContent, true);
  // Unreleased 及其说明子节保留在顶部
  assert.match(updated, /^## \[Unreleased\]$/m);
  assert.match(updated, /### 说明 \/ Note\n\n活跃开发中原型。/);
  // 新版本标题插在第一个月份分节之前
  assert.match(updated, /## \[0\.1\.1\] - 2026-08-30\n\n### 2026-08/);
  // 月份内容完整迁移（含 2026-07 全部条目）
  assert.match(updated, /- 新功能乙/);
  // 迁移内容包含两个月份分节
  assert.match(releasedSection, /^### 2026-08/);
  assert.match(releasedSection, /### 2026-07/);
  // 原 Unreleased 下方不再残留月份分节（第一个 YYYY-MM 出现在新版本标题之后）
  const firstDatedIdx = updated.search(/^### \d{4}-\d{2}$/m);
  const newHeadingIdx = updated.indexOf('## [0.1.1]');
  assert.ok(firstDatedIdx > newHeadingIdx);
});

test('cutChangelog 对无月份内容的 Unreleased 发布空分节', () => {
  const empty = SAMPLE_CHANGELOG.split('### 2026-08')[0].trimEnd() + '\n';
  const { updated, releasedSection, hadDatedContent } = cutChangelog(empty, '0.1.1', '2026-08-30');
  assert.equal(hadDatedContent, false);
  assert.equal(releasedSection, '');
  assert.match(updated, /## \[0\.1\.1\] - 2026-08-30/);
});

test('cutChangelog 缺少 Unreleased 分节时抛错', () => {
  assert.throws(() => cutChangelog('# 标题\n\n## [0.1.0]\n', '0.1.1', '2026-08-30'), /Unreleased/);
});

test('cutChangelog 保留 CRLF 行尾风格', () => {
  const crlf = SAMPLE_CHANGELOG.replace(/\n/g, '\r\n');
  const { updated } = cutChangelog(crlf, '0.1.1', '2026-08-30');
  assert.ok(updated.includes('## [0.1.1] - 2026-08-30\r\n\r\n### 2026-08'));
});

// ---------------------------------------------------------------------------
// TOML / Cargo.lock 版本替换
// ---------------------------------------------------------------------------

const SAMPLE_PYPROJECT = '[build-system]\nrequires = ["setuptools"]\n\n[project]\nname = "precis"\nversion = "0.1.0"\ndescription = "test"\n';

const SAMPLE_CARGO_TOML = '[package]\nname = "precis-tui"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nanyhow = "1"\n';

const SAMPLE_CARGO_LOCK = [
  '# This file is automatically @generated by Cargo.',
  '',
  '[[package]]',
  'name = "precis-tui"',
  'version = "0.1.0"',
  'dependencies = [',
  '  "anyhow",',
  ']',
  '',
  '[[package]]',
  'name = "other-crate"',
  'version = "9.9.9"',
  '',
].join('\n');

test('pyproject [project] version 读写', () => {
  assert.equal(readTomlSectionVersion(SAMPLE_PYPROJECT, 'project'), '0.1.0');
  const updated = writeTomlSectionVersion(SAMPLE_PYPROJECT, 'project', '0.2.0');
  assert.equal(readTomlSectionVersion(updated, 'project'), '0.2.0');
  // 其余内容不动
  assert.match(updated, /\[build-system\]/);
  assert.match(updated, /name = "precis"/);
});

test('Cargo.toml [package] version 读写', () => {
  assert.equal(readTomlSectionVersion(SAMPLE_CARGO_TOML, 'package'), '0.1.0');
  const updated = writeTomlSectionVersion(SAMPLE_CARGO_TOML, 'package', '0.3.0');
  assert.equal(readTomlSectionVersion(updated, 'package'), '0.3.0');
  assert.match(updated, /anyhow = "1"/);
});

test('Cargo.lock 只替换指定包块的 version', () => {
  assert.equal(readCargoLockVersion(SAMPLE_CARGO_LOCK, 'precis-tui'), '0.1.0');
  const updated = writeCargoLockVersion(SAMPLE_CARGO_LOCK, 'precis-tui', '0.2.0');
  assert.equal(readCargoLockVersion(updated, 'precis-tui'), '0.2.0');
  // 其他包不受影响
  assert.match(updated, /name = "other-crate"\nversion = "9\.9\.9"/);
});

// ---------------------------------------------------------------------------
// 发布提交清单
// ---------------------------------------------------------------------------

test('releaseCommitFiles 覆盖六处 manifest + 三份 package-lock.json + CHANGELOG', () => {
  const files = releaseCommitFiles();
  // npm version 连带写 lockfile 的版本字段，漏提交会残留脏工作树阻塞下次发布（v0.1.1 实证）
  for (const lock of ['package-lock.json', 'frontend/package-lock.json', 'electron/package-lock.json']) {
    assert.ok(files.includes(lock), `发布提交清单缺少 ${lock}`);
  }
  assert.deepEqual(files, [
    'package.json',
    'frontend/package.json',
    'electron/package.json',
    'backend/pyproject.toml',
    'tui-rust/Cargo.toml',
    'tui-rust/Cargo.lock',
    'package-lock.json',
    'frontend/package-lock.json',
    'electron/package-lock.json',
    'CHANGELOG.md',
  ]);
});

// ---------------------------------------------------------------------------
// tag 工具
// ---------------------------------------------------------------------------

test('latestVersionTag 取 semver 最大者并忽略非 semver tag', () => {
  assert.equal(latestVersionTag(['v0.1.0', 'v0.2.0-alpha.1', 'v0.1.9', 'tui-base-v1']), 'v0.2.0-alpha.1');
  assert.equal(latestVersionTag(['tui-base-v1']), null);
  assert.equal(latestVersionTag([]), null);
});

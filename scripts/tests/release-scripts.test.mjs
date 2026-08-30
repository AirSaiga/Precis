/**
 * extract-release-notes.mjs / verify-release-assets.mjs 纯函数单元测试（node --test）
 *
 * 运行: npm run test:scripts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReleaseNotes } from '../extract-release-notes.mjs';
import { parseLatestYml } from '../verify-release-assets.mjs';

const SAMPLE = [
  '# 变更日志 / Changelog',
  '',
  '## [Unreleased]',
  '',
  '### 说明 / Note',
  '',
  '开发中。',
  '',
  '## [0.1.1] - 2026-08-30',
  '',
  '### 2026-08',
  '',
  '- 修复甲',
  '',
  '  Fix A',
  '',
  '## [0.1.0] - 2026-06-22',
  '',
  '- 首个版本',
  '',
].join('\n');

test('extractReleaseNotes 提取指定版本分节（到下一个 ## 为止）', () => {
  const section = extractReleaseNotes(SAMPLE, '0.1.1');
  assert.match(section, /### 2026-08/);
  assert.match(section, /- 修复甲/);
  assert.ok(!section.includes('首个版本'));
  assert.ok(!section.includes('说明 / Note'));
});

test('extractReleaseNotes 提取最后一个版本分节（到文件尾）', () => {
  const section = extractReleaseNotes(SAMPLE, '0.1.0');
  assert.match(section, /- 首个版本/);
});

test('extractReleaseNotes 不存在的版本返回 null', () => {
  assert.equal(extractReleaseNotes(SAMPLE, '9.9.9'), null);
});

test('extractReleaseNotes 对含点号等正则元字符的版本安全', () => {
  assert.notEqual(extractReleaseNotes(SAMPLE, '0.1.1'), null);
  assert.equal(extractReleaseNotes(SAMPLE, '0x1x1'), null);
});

// ---------------------------------------------------------------------------
// parseLatestYml —— 以 electron-builder 真实输出格式为准
// （格式源自 electron/release/latest.yml 的实际产物样本）
// ---------------------------------------------------------------------------

const SAMPLE_LATEST_YML = [
  'version: 0.1.1',
  'files:',
  '  - url: Precis-Setup-0.1.1.exe',
  '    sha512: AbCdEf==',
  '    size: 228378561',
  'path: Precis-Setup-0.1.1.exe',
  'sha512: AbCdEf==',
  'releaseDate: \'2026-08-30T07:14:44.696Z\'',
].join('\n');

test('parseLatestYml 提取 version 与 files 条目', () => {
  const parsed = parseLatestYml(SAMPLE_LATEST_YML);
  assert.equal(parsed.version, '0.1.1');
  assert.equal(parsed.files.length, 1);
  assert.deepEqual(parsed.files[0], { url: 'Precis-Setup-0.1.1.exe', sha512: 'AbCdEf==', size: '228378561' });
});

test('parseLatestYml 兼容 CRLF 与无 files 的非法清单', () => {
  const parsed = parseLatestYml(SAMPLE_LATEST_YML.replace(/\n/g, '\r\n'));
  assert.equal(parsed.version, '0.1.1');
  assert.equal(parsed.files.length, 1);

  const empty = parseLatestYml('version: 1.0.0\n');
  assert.equal(empty.version, '1.0.0');
  assert.equal(empty.files.length, 0);
});

test('parseLatestYml 支持多文件条目（差分 blockmap 场景）', () => {
  const multi = [
    'version: 2.0.0',
    'files:',
    '  - url: A.exe',
    '    sha512: AAA==',
    '    size: 100',
    '  - url: A.exe.blockmap',
    '    sha512: BBB==',
    '    size: 200',
    'path: A.exe',
  ].join('\n');
  const parsed = parseLatestYml(multi);
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[1].url, 'A.exe.blockmap');
  assert.equal(parsed.files[1].sha512, 'BBB==');
});

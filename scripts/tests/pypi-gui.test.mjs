/**
 * pypi-gui.mjs / verify-pypi-package.mjs 纯函数单元测试（node --test）
 *
 * 重点：PyPI releases 映射与排序、四方版本对齐语义、pypistats 聚合、
 *       CHANGELOG 解析、动作拼装白名单（防命令注入）、验证契约检查。
 * 运行: npm run test:scripts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  mapPypiReleases,
  computeAlignment,
  aggregateByCategory,
  mapOverallTotals,
  parseChangelogVersions,
  buildPypiActionCommand,
} from '../release/pypi-gui.mjs';
import {
  checkVersionOutput,
  checkValidatePayload,
  venvPython,
  venvPrecis,
  parseVerifyArgs,
} from '../release/verify-pypi-package.mjs';

// ---------------------------------------------------------------------------
// mapPypiReleases
// ---------------------------------------------------------------------------

function makePypiFile(overrides = {}) {
  return {
    filename: 'precis_cli-0.1.5-py3-none-any.whl',
    packagetype: 'bdist_wheel',
    size: 123456,
    upload_time_iso_8601: '2026-09-21T10:00:00Z',
    yanked: false,
    digests: { sha256: 'a'.repeat(64) },
    ...overrides,
  };
}

test('mapPypiReleases 按 semver 降序排列并映射文件字段', () => {
  const json = {
    info: { version: '0.2.0' },
    releases: {
      '0.1.4': [makePypiFile({ filename: 'precis_cli-0.1.4-py3-none-any.whl', packagetype: 'bdist_wheel' })],
      '0.2.0-alpha.1': [makePypiFile({ filename: 'precis_cli-0.2.0a1-py3-none-any.whl' })],
      '0.2.0': [
        makePypiFile(),
        makePypiFile({
          filename: 'precis_cli-0.2.0.tar.gz',
          packagetype: 'sdist',
          size: 999,
          upload_time_iso_8601: '2026-09-22T08:00:00Z',
          digests: { sha256: 'b'.repeat(64) },
        }),
      ],
    },
  };
  const out = mapPypiReleases(json);
  assert.deepEqual(
    out.map((r) => r.version),
    ['0.2.0', '0.2.0-alpha.1', '0.1.4'],
  );
  const top = out[0];
  assert.equal(top.uploadTime, '2026-09-22T08:00:00Z'); // 取该版本最晚上传时间
  assert.equal(top.files.length, 2);
  const sdist = top.files.find((f) => f.name === 'precis_cli-0.2.0.tar.gz');
  assert.equal(sdist.kind, 'sdist');
  assert.equal(sdist.sha256, 'b'.repeat(64));
  const wheel = top.files.find((f) => f.name.endsWith('.whl'));
  assert.equal(wheel.kind, 'wheel');
});

test('mapPypiReleases：版本级 yanked = 全部文件被 yank；部分 yank 不算；空文件版本跳过', () => {
  const out = mapPypiReleases({
    releases: {
      '1.0.0': [makePypiFile({ yanked: true })],
      '0.9.0': [makePypiFile({ yanked: true }), makePypiFile({ filename: 'precis_cli-0.9.0.tar.gz', packagetype: 'sdist', yanked: false })],
      '0.8.0': [],
      '0.7.0': [makePypiFile({ filename: 'precis_cli-0.7.0.tar.gz', packagetype: 'sdist', yanked: true })],
    },
  });
  assert.equal(out.length, 3); // 0.8.0 无文件被跳过
  const byVersion = Object.fromEntries(out.map((r) => [r.version, r.yanked]));
  assert.equal(byVersion['1.0.0'], true); // 全部 yank
  assert.equal(byVersion['0.9.0'], false); // 部分 yank
  assert.equal(byVersion['0.7.0'], true); // sdist 单文件 yank
});

test('mapPypiReleases：空/畸形输入容错', () => {
  assert.deepEqual(mapPypiReleases({}), []);
  assert.deepEqual(mapPypiReleases(null), []);
  assert.deepEqual(mapPypiReleases({ releases: null }), []);
});

// ---------------------------------------------------------------------------
// computeAlignment（四方对齐语义）
// ---------------------------------------------------------------------------

test('computeAlignment：四方一致 → ok', () => {
  const { overall, checks } = computeAlignment({
    rootVersion: '0.1.5',
    allConsistent: true,
    latestTag: 'v0.1.5',
    ghReleaseTag: 'v0.1.5',
    pypiVersion: '0.1.5',
  });
  assert.equal(overall, 'ok');
  assert.equal(checks.every((c) => c.status === 'ok'), true);
});

test('computeAlignment：tag 已发但 PyPI 落后 → warn（pypi job 失败/发布中的关键信号）', () => {
  const { overall, checks } = computeAlignment({
    rootVersion: '0.1.5',
    allConsistent: true,
    latestTag: 'v0.1.5',
    ghReleaseTag: 'v0.1.5',
    pypiVersion: '0.1.4',
  });
  assert.equal(overall, 'warn');
  const pypiCheck = checks.find((c) => c.key === 'tag-pypi');
  assert.equal(pypiCheck.status, 'warn');
  assert.match(pypiCheck.detail, /落后/);
});

test('computeAlignment：本地领先 tag（开发中）→ info，不算异常', () => {
  const { overall, checks } = computeAlignment({
    rootVersion: '0.2.0',
    allConsistent: true,
    latestTag: 'v0.1.5',
    ghReleaseTag: 'v0.1.5',
    pypiVersion: '0.1.5',
  });
  assert.equal(overall, 'info');
  assert.equal(checks.find((c) => c.key === 'local-tag').status, 'info');
  assert.equal(checks.find((c) => c.key === 'tag-pypi').status, 'ok');
});

test('computeAlignment：manifest 不一致 → error；PyPI 高于 tag → error', () => {
  const manifestDrift = computeAlignment({
    rootVersion: '0.1.5',
    allConsistent: false,
    latestTag: 'v0.1.5',
    ghReleaseTag: 'v0.1.5',
    pypiVersion: '0.1.5',
  });
  assert.equal(manifestDrift.overall, 'error');

  const roguePypi = computeAlignment({
    rootVersion: '0.1.5',
    allConsistent: true,
    latestTag: 'v0.1.5',
    ghReleaseTag: 'v0.1.5',
    pypiVersion: '0.2.0',
  });
  assert.equal(roguePypi.overall, 'error');
  assert.equal(roguePypi.checks.find((c) => c.key === 'tag-pypi').status, 'error');
});

test('computeAlignment：数据源缺失记 unknown，不参与定档（GitHub 拉取失败不误报）', () => {
  const { overall, checks } = computeAlignment({
    rootVersion: '0.1.5',
    allConsistent: true,
    latestTag: 'v0.1.5',
    ghReleaseTag: null, // GitHub 拉取失败
    pypiVersion: '0.1.5',
  });
  assert.equal(overall, 'ok');
  assert.equal(checks.find((c) => c.key === 'tag-release').status, 'unknown');

  const nothing = computeAlignment({ rootVersion: null, allConsistent: true, latestTag: null, ghReleaseTag: null, pypiVersion: null });
  // 尚未发布的初始态：local-tag 归 info（"仓库尚无 v* tag"），其余 unknown
  assert.equal(nothing.overall, 'info');
  assert.equal(nothing.checks.find((c) => c.key === 'manifests').status, 'unknown');
});

// ---------------------------------------------------------------------------
// aggregateByCategory（pypistats）
// ---------------------------------------------------------------------------

test('aggregateByCategory：按 category 求和、降序、截断 TopN；排除 Total/畸形行，保留 "null"（未知环境流量）', () => {
  const rows = [
    { category: '3.12', date: '2026-09-20', downloads: 10 },
    { category: '3.12', date: '2026-09-21', downloads: 15 },
    { category: 'Linux', downloads: 40 },
    { category: 'null', downloads: 263 },
    { category: 'Total', downloads: 9999 },
    { category: null, downloads: 5 },
    { category: 'bad', downloads: NaN },
    null,
  ];
  assert.deepEqual(aggregateByCategory(rows, 3), [
    { category: 'null', downloads: 263 },
    { category: 'Linux', downloads: 40 },
    { category: '3.12', downloads: 25 },
  ]);
  assert.deepEqual(aggregateByCategory([]), []);
  assert.deepEqual(aggregateByCategory(undefined), []);
  assert.deepEqual(aggregateByCategory([{ category: '3.12', downloads: 7 }]), [{ category: '3.12', downloads: 7 }]);
});

// ---------------------------------------------------------------------------
// mapOverallTotals（pypistats /overall 端点：含/不含镜像两行总量，非版本分布）
// ---------------------------------------------------------------------------

test('mapOverallTotals：两行总量映射，同 category 多行取最新日期', () => {
  const rows = [
    { category: 'with_mirrors', date: '2026-09-19', downloads: 800 },
    { category: 'with_mirrors', date: '2026-09-20', downloads: 851 },
    { category: 'without_mirrors', date: '2026-09-20', downloads: 292 },
  ];
  assert.deepEqual(mapOverallTotals(rows), {
    withMirrors: { downloads: 851, date: '2026-09-20' },
    withoutMirrors: { downloads: 292, date: '2026-09-20' },
  });
});

test('mapOverallTotals：缺行/空输入容错', () => {
  assert.equal(mapOverallTotals([]), null);
  assert.equal(mapOverallTotals(null), null);
  assert.deepEqual(mapOverallTotals([{ category: 'without_mirrors', downloads: 5 }]), {
    withMirrors: null,
    withoutMirrors: { downloads: 5, date: null },
  });
});

// ---------------------------------------------------------------------------
// parseChangelogVersions
// ---------------------------------------------------------------------------

test('parseChangelogVersions：提取 [X.Y.Z] 小节头，跳过 Unreleased 与重复', () => {
  const md = `# 变更日志

## [Unreleased]

### 2026-09
- 开发中条目

## [0.1.5] - 2026-09-21

### 2026-09
- 内容

## [0.2.0-alpha.1] - 2026-09-22

## [0.1.5] - 2026-09-21
`;
  assert.deepEqual(parseChangelogVersions(md), ['0.1.5', '0.2.0-alpha.1']);
  assert.deepEqual(parseChangelogVersions(''), []);
  assert.deepEqual(parseChangelogVersions(null), []);
  assert.deepEqual(parseChangelogVersions('## [Unreleased]\n## 无版本头'), []);
});

// ---------------------------------------------------------------------------
// buildPypiActionCommand（动作枚举与注入防护）
// ---------------------------------------------------------------------------

test('buildPypiActionCommand：verify-pypi 拼装受控命令', () => {
  const { label, cmd, cwd } = buildPypiActionCommand('verify-pypi', { version: '0.1.5' });
  assert.match(label, /0\.1\.5/);
  assert.equal(cmd, 'node scripts/release/verify-pypi-package.mjs --version 0.1.5');
  assert.equal(cwd, path.resolve(import.meta.dirname, '../..'));
});

test('buildPypiActionCommand：注入向量与未知动作被拒绝', () => {
  assert.throws(() => buildPypiActionCommand('verify-pypi', { version: '0.1.1; rm -rf' }), /非法/);
  assert.throws(() => buildPypiActionCommand('verify-pypi', { version: 'a && whoami' }), /非法/);
  assert.throws(() => buildPypiActionCommand('verify-pypi', { version: '$(calc)' }), /非法/);
  assert.throws(() => buildPypiActionCommand('verify-pypi', { version: '' }), /非法/);
  assert.throws(() => buildPypiActionCommand('rm-rf', {}), /未知动作/);
  assert.throws(() => buildPypiActionCommand(null, {}), /未知动作/);
});

// ---------------------------------------------------------------------------
// verify-pypi-package.mjs 纯函数
// ---------------------------------------------------------------------------

test('checkVersionOutput：包含即匹配', () => {
  assert.equal(checkVersionOutput('precis 0.1.5 (cli)', '0.1.5'), true);
  assert.equal(checkVersionOutput('precis 0.1.4', '0.1.5'), false);
  assert.equal(checkVersionOutput('', '0.1.5'), false);
  assert.equal(checkVersionOutput('precis 0.1.5', null), false);
});

test('checkValidatePayload：8 违规基线通过；各失败形态返回具体 problems', () => {
  const okPayload = { schema_version: 1, is_valid: false, errors: Array.from({ length: 8 }) };
  assert.deepEqual(checkValidatePayload(okPayload), { ok: true, problems: [] });

  const badCount = checkValidatePayload({ schema_version: 1, is_valid: false, errors: [] });
  assert.equal(badCount.ok, false);
  assert.match(badCount.problems.join(';'), /期望 8 处违规/);

  const badAll = checkValidatePayload({ schema_version: 2, is_valid: true, errors: [] });
  assert.equal(badAll.ok, false);
  assert.equal(badAll.problems.length, 3);

  assert.equal(checkValidatePayload(null).ok, false);
  assert.equal(checkValidatePayload('not-object').ok, false);
  assert.equal(checkValidatePayload([1, 2]).ok, false);
});

test('venvPython / venvPrecis：平台差异路径', () => {
  assert.equal(venvPython('V', 'win32'), path.join('V', 'Scripts', 'python.exe'));
  assert.equal(venvPython('V', 'darwin'), path.join('V', 'bin', 'python'));
  assert.equal(venvPrecis('V', 'win32'), path.join('V', 'Scripts', 'precis.exe'));
  assert.equal(venvPrecis('V', 'linux'), path.join('V', 'bin', 'precis'));
});

test('parseVerifyArgs：形状、缺省值与 --xxx=yyy 形态', () => {
  const a = parseVerifyArgs(['--version', '0.1.5']);
  assert.equal(a.version, '0.1.5');
  assert.equal(a.keep, false);
  assert.equal(a.python, process.env.PRECIS_PYTHON || 'python');

  const b = parseVerifyArgs(['--version=0.2.0', '--index-url=https://mirrors.example.com/pypi/simple', '--keep', '--python=C:/py312/python.exe']);
  assert.equal(b.version, '0.2.0');
  assert.equal(b.indexUrl, 'https://mirrors.example.com/pypi/simple');
  assert.equal(b.keep, true);
  assert.equal(b.python, 'C:/py312/python.exe');

  assert.equal(parseVerifyArgs(['--help']).help, true);
  assert.equal(parseVerifyArgs(['--bogus']).unknown, '--bogus');
});

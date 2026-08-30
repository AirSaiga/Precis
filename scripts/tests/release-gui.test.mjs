/**
 * release-gui.mjs 纯函数单元测试（node --test）
 *
 * 重点：输入校验白名单（防命令注入）与 动作→命令 拼装映射。
 * 运行: npm run test:scripts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateVersionish,
  validateTag,
  validatePort,
  buildActionCommand,
  createLineSplitter,
} from '../release-gui.mjs';

// ---------------------------------------------------------------------------
// 输入校验白名单（GUI 的安全边界：所有用户输入先过这里才允许进入 shell 字符串）
// ---------------------------------------------------------------------------

test('validateVersionish 接受 semver 字符集，拒绝 shell 元字符', () => {
  assert.equal(validateVersionish('0.1.1'), true);
  assert.equal(validateVersionish('0.2.0-alpha.1'), true);
  assert.equal(validateVersionish('1.0.0+build.5'), true);
  // 注入向量全部拒绝
  assert.equal(validateVersionish('0.1.1; rm -rf'), false);
  assert.equal(validateVersionish('a && whoami'), false);
  assert.equal(validateVersionish('$(whoami)'), false);
  assert.equal(validateVersionish('`id`'), false);
  assert.equal(validateVersionish('../etc/passwd'), false);
  assert.equal(validateVersionish(''), false);
  assert.equal(validateVersionish(null), false);
  assert.equal(validateVersionish(undefined), false);
  assert.equal(validateVersionish('9'.repeat(64)), false); // 超长
});

test('validateTag 要求 v 前缀 + 版本字符集', () => {
  assert.equal(validateTag('v0.1.1'), true);
  assert.equal(validateTag('v0.2.0-alpha.1'), true);
  assert.equal(validateTag('0.1.1'), false);
  assert.equal(validateTag('v0.1.1; calc'), false);
  assert.equal(validateTag(''), false);
});

test('validatePort 仅接受合法端口数字', () => {
  assert.equal(validatePort('8080'), true);
  assert.equal(validatePort('17888'), true);
  assert.equal(validatePort('80'), true);
  assert.equal(validatePort('0'), false);
  assert.equal(validatePort('99999'), false);
  assert.equal(validatePort('abc'), false);
  assert.equal(validatePort('8080; rm'), false);
});

// ---------------------------------------------------------------------------
// buildActionCommand 动作映射
// ---------------------------------------------------------------------------

test('build 动作按平台选择 dist:win / dist:mac', () => {
  assert.match(buildActionCommand('build', {}, 'win32').cmd, /dist:win/);
  assert.match(buildActionCommand('build', {}, 'darwin').cmd, /dist:mac/);
});

test('release-dry 携带版本与 --dry-run 标志', () => {
  const { cmd, cwd } = buildActionCommand('release-dry', { version: '0.1.1' });
  assert.match(cmd, /release\.mjs 0\.1\.1 --dry-run/);
  assert.ok(cwd.endsWith('Precis') || cwd.endsWith('precis'));
});

test('release 动作支持 --no-push，默认推送', () => {
  assert.match(buildActionCommand('release', { version: '0.1.1' }).cmd, /release\.mjs 0\.1\.1$/);
  assert.match(buildActionCommand('release', { version: '0.1.1', noPush: true }).cmd, /--no-push/);
});

test('drill 动作拼装 lite / full 参数', () => {
  assert.match(
    buildActionCommand('drill-lite', { version: '9.9.9-drill' }).cmd,
    /update-drill\.mjs lite --version 9\.9\.9-drill/,
  );
  const full = buildActionCommand('drill-full', { base: '0.1.0', next: '0.1.1' });
  assert.match(full.cmd, /full --base 0\.1\.0 --next 0\.1\.1/);
});

test('verify-release 强制 v 前缀 tag + 仓库固定（不接受客户端指定 repo）', () => {
  const { cmd } = buildActionCommand('verify-release', { tag: 'v0.1.1', version: '0.1.1' });
  assert.match(cmd, /--repo AirSaiga\/Precis --tag v0\.1\.1 --version 0\.1\.1/);
});

test('未知动作与非法参数抛错', () => {
  assert.throws(() => buildActionCommand('rm-rf', {}), /未知动作/);
  assert.throws(() => buildActionCommand('release-dry', { version: '0.1.1; rm' }), /非法/);
  assert.throws(() => buildActionCommand('verify-release', { tag: '0.1.1', version: '0.1.1' }), /tag 非法/);
  assert.throws(() => buildActionCommand('drill-full', { base: 'x; rm', next: '0.1.1' }), /非法/);
});

// ---------------------------------------------------------------------------
// createLineSplitter 行切分
// ---------------------------------------------------------------------------

test('createLineSplitter 处理跨 chunk 断行与 CRLF', () => {
  const lines = [];
  const splitter = createLineSplitter((l) => lines.push(l));
  splitter.push('first\r\nsec');
  splitter.push('ond line\n');
  splitter.push('tail without newline');
  splitter.flush();
  assert.deepEqual(lines, ['first', 'second line', 'tail without newline']);
});

test('createLineSplitter 忽略空行', () => {
  const lines = [];
  const splitter = createLineSplitter((l) => lines.push(l));
  splitter.push('\n\na\n\n');
  splitter.flush();
  assert.deepEqual(lines, ['a']);
});

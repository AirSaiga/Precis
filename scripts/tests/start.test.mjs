/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview start.mjs 纯函数单元测试（node --test）
 *
 * 覆盖：target 映射表完整性、合法 target 双平台解析到真实存在的脚本文件、
 * 别名归一、非法 target 报错含可用列表、平台归一。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  START_TARGETS,
  TARGET_ALIASES,
  canonicalTarget,
  resolveScriptRelPath,
  availableTargetsText,
  usageText,
} from '../start.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('START_TARGETS 覆盖 7 个语义化 target 且不残留平台后缀命名', () => {
  assert.deepEqual(Object.keys(START_TARGETS), ['dev', 'prod', 'backend', 'frontend', 'electron', 'cli', 'tui']);
});

test('合法 target 在两个平台都解析到真实存在的脚本文件', () => {
  for (const target of Object.keys(START_TARGETS)) {
    for (const platform of ['win32', 'darwin']) {
      const rel = resolveScriptRelPath(target, platform);
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${target}@${platform} → ${rel} 应真实存在`);
    }
  }
});

test('平台归一：win32 走 windows 目录，darwin/linux 走 mac 目录', () => {
  assert.equal(resolveScriptRelPath('dev', 'win32'), 'scripts/windows/start-dev.bat');
  assert.equal(resolveScriptRelPath('dev', 'darwin'), 'scripts/mac/start-dev.sh');
  assert.equal(resolveScriptRelPath('tui', 'linux'), 'scripts/mac/start-tui-rust.sh');
});

test('别名归一：desktop→electron，tui-rust→tui，未知/非字符串→null', () => {
  assert.equal(canonicalTarget('desktop'), 'electron');
  assert.equal(canonicalTarget('tui-rust'), 'tui');
  assert.equal(canonicalTarget('nope'), null);
  assert.equal(canonicalTarget(''), null);
  assert.equal(canonicalTarget(undefined), null);
  assert.equal(canonicalTarget(42), null);
});

test('别名与正名解析出相同脚本', () => {
  assert.equal(resolveScriptRelPath('desktop'), resolveScriptRelPath('electron'));
  assert.equal(resolveScriptRelPath('tui-rust'), resolveScriptRelPath('tui'));
});

test('非法 target 报错信息包含可用列表', () => {
  assert.throws(
    () => resolveScriptRelPath('badtarget'),
    (err) =>
      err instanceof Error &&
      err.message.includes('badtarget') &&
      Object.keys(START_TARGETS).every((name) => err.message.includes(name)),
  );
});

test('可用列表与用法文案覆盖全部 target 及别名', () => {
  const list = availableTargetsText();
  for (const name of Object.keys(START_TARGETS)) assert.ok(list.includes(name), `列表应含 ${name}`);
  for (const [from, to] of Object.entries(TARGET_ALIASES)) {
    assert.ok(list.includes(from) && list.includes(to), `列表应含别名 ${from}=${to}`);
  }
  for (const name of Object.keys(START_TARGETS)) assert.ok(usageText().includes(`  ${name.padEnd(9)}`));
});

test('release-gui / pypi-gui 有意不经本入口（已有 npm run release:gui / pypi:gui）', () => {
  assert.equal(canonicalTarget('release-gui'), null);
  assert.equal(canonicalTarget('pypi-gui'), null);
});

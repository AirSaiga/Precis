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
 * @fileoverview verify-extras-matrix.mjs 纯函数单元测试（node --test）
 *
 * 覆盖：形态定义表完整性、installTarget 组装、指引/握手断言谓词、
 * 参数解析与形态选择、venv 路径推导。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  VARIANTS,
  installTarget,
  checkVersionOutput,
  checkGuidance,
  checkMcpHandshake,
  parseArgs,
  selectVariants,
  venvPython,
  venvBin,
} from '../release/verify-extras-matrix.mjs';

test('VARIANTS 覆盖 5 种形态且名称唯一', () => {
  const names = VARIANTS.map((v) => v.name);
  assert.deepEqual(names, ['bare', 'api', 'ai', 'mcp', 'full']);
  assert.equal(new Set(names).size, 5);
});

test('VARIANTS: bare 只做负向指引断言，full 只做正向断言', () => {
  const bare = VARIANTS.find((v) => v.name === 'bare');
  assert.equal(bare.extras, '');
  assert.equal(bare.checks.mcpGuidance, true);
  assert.equal(bare.checks.apiGuidance, true);
  assert.equal(bare.checks.aiGuidance, true);
  assert.equal(bare.checks.apiAvailable ?? false, false);

  const full = VARIANTS.find((v) => v.name === 'full');
  assert.equal(full.extras, 'full');
  assert.equal(full.checks.apiAvailable, true);
  assert.equal(full.checks.aiAvailable, true);
  assert.equal(full.checks.mcpHandshake, true);
  assert.equal(full.checks.mcpGuidance ?? false, false);
});

test('installTarget: wheel 路径 + extras 后缀组装', () => {
  const wheel = path.join('tmp', 'precis_cli-0.1.6-py3-none-any.whl');
  assert.equal(installTarget({ wheelPath: wheel, usePyPI: false, extras: '' }), wheel);
  assert.equal(installTarget({ wheelPath: wheel, usePyPI: false, extras: 'api' }), `${wheel}[api]`);
  assert.equal(installTarget({ wheelPath: null, usePyPI: true, extras: 'mcp' }), 'precis-cli[mcp]');
  assert.equal(installTarget({ wheelPath: null, usePyPI: true, extras: '' }), 'precis-cli');
  assert.throws(() => installTarget({ wheelPath: null, usePyPI: false, extras: '' }), /wheelPath/);
});

test('checkVersionOutput: 包含期望版本', () => {
  assert.equal(checkVersionOutput('precis 0.1.6', '0.1.6'), true);
  assert.equal(checkVersionOutput('precis 0.1.6', '0.1.7'), false);
  assert.equal(checkVersionOutput(null, '0.1.6'), false);
});

test('checkGuidance: 退出码 1 且输出含指引串', () => {
  assert.equal(checkGuidance({ code: 1, out: "请执行 pip install 'precis-cli[mcp]'", hint: 'precis-cli[mcp]' }), true);
  assert.equal(checkGuidance({ code: 0, out: "pip install 'precis-cli[mcp]'", hint: 'precis-cli[mcp]' }), false);
  assert.equal(checkGuidance({ code: 1, out: '别的错误', hint: 'precis-cli[mcp]' }), false);
});

test('checkMcpHandshake: 合法 initialize 响应判定', () => {
  assert.equal(
    checkMcpHandshake({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'precis' } } }),
    true,
  );
  assert.equal(checkMcpHandshake({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'other' } } }), false);
  assert.equal(checkMcpHandshake({ jsonrpc: '2.0', id: 2, result: { serverInfo: { name: 'precis' } } }), false);
  assert.equal(checkMcpHandshake(null), false);
});

test('parseArgs: 旗标与取值参数', () => {
  const a = parseArgs(['--pypi', '--python', 'py', '--variants', 'bare,mcp', '--keep']);
  assert.equal(a.pypi, true);
  assert.equal(a.keep, true);
  assert.equal(a.python, 'py');
  assert.equal(a.variants, 'bare,mcp');

  const b = parseArgs([]);
  assert.equal(b.pypi, false);
  assert.equal(b.variants, null);

  const c = parseArgs(['--python=python3', '--variants=full']);
  assert.equal(c.python, 'python3');
  assert.equal(c.variants, 'full');

  assert.equal(parseArgs(['--nope']).unknown, '--nope');
  assert.equal(parseArgs(['--help']).help, true);
});

test('selectVariants: 缺省全量、白名单校验', () => {
  assert.deepEqual(selectVariants(null), ['bare', 'api', 'ai', 'mcp', 'full']);
  assert.deepEqual(selectVariants('bare, full'), ['bare', 'full']);
  assert.throws(() => selectVariants('bare,wat'), /未知形态: wat/);
});

test('venvPython/venvBin: 平台路径推导', () => {
  assert.equal(venvPython('/v', 'win32'), path.join('/v', 'Scripts', 'python.exe'));
  assert.equal(venvPython('/v', 'linux'), path.join('/v', 'bin', 'python'));
  assert.equal(venvBin('/v', 'win32'), path.join('/v', 'Scripts'));
  assert.equal(venvBin('/v', 'linux'), path.join('/v', 'bin'));
});

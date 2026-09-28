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
 * @fileoverview check-license-headers.mjs 纯函数单元测试（node --test）
 *
 * 覆盖：git 清单筛选范围规则、前 15 行缺头识别与行边界、
 * 关键回归——git 仍跟踪但工作树已删除（未暂存 rm）的文件跳过而非 ENOENT 崩溃。
 *
 * 运行: npm run test:scripts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectLicenseScopeFiles, findMissingLicenseHeaders } from '../check-license-headers.mjs';

test('selectLicenseScopeFiles 保留全部纳入范围的模式', () => {
  const out = [
    'frontend/src/main.ts',
    'frontend/src/App.vue',
    'frontend/src/style.css',
    'frontend/tests/unit/foo.test.ts',
    'frontend/scripts/gen-types.mjs',
    'frontend/vite.config.ts',
    'frontend/index.html',
    'backend/app/main.py',
    'electron/src/main.ts',
    'tui-rust/src/main.rs',
    'e2e/flows/flow.spec.ts',
    '',
  ].join('\n');
  assert.deepEqual(selectLicenseScopeFiles(out), [
    'frontend/src/main.ts',
    'frontend/src/App.vue',
    'frontend/src/style.css',
    'frontend/tests/unit/foo.test.ts',
    'frontend/scripts/gen-types.mjs',
    'frontend/vite.config.ts',
    'frontend/index.html',
    'backend/app/main.py',
    'electron/src/main.ts',
    'tui-rust/src/main.rs',
    'e2e/flows/flow.spec.ts',
  ]);
});

test('selectLicenseScopeFiles 排除范围外/排除目录/生成物/空行，并归一反斜杠', () => {
  const out = [
    'docs/ARCHITECTURE.md', // 目录不在任何 include 模式
    'scripts/check-license-headers.mjs', // 根 scripts/ 不在 include 模式
    'backend/app/__pycache__/main.cpython-312.pyc', // __pycache__（扩展名也不符）
    'backend/app/__pycache__/helper.py', // 排除目录：__pycache__
    'frontend/node_modules/foo/index.mjs', // 排除目录：node_modules（frontend/src 下的也排除）
    'frontend/src/types/generated/actions.ts', // 排除文件：generated/
    'frontend/src/foo.py.html.txt', // 扩展名不符
    '   ',
    '',
  ].join('\n');
  assert.deepEqual(selectLicenseScopeFiles(out), []);
  // git ls-files 输出统一正斜杠；反斜杠路径也归一后按同一规则判断
  assert.deepEqual(selectLicenseScopeFiles('frontend\\src\\Foo.vue'), ['frontend/src/Foo.vue']);
  assert.deepEqual(selectLicenseScopeFiles('frontend\\node_modules\\foo\\index.mjs'), []);
});

test('findMissingLicenseHeaders 识别缺头文件，SPDX 与 Apache License 两种头均放行', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-license-'));
  try {
    fs.writeFileSync(path.join(dir, 'with-spdx.ts'), '/* SPDX-License-Identifier: Apache-2.0 */\nexport {}\n');
    fs.writeFileSync(
      path.join(dir, 'with-apache.py'),
      '#\n# Apache License\n# Version 2.0, January 2004\n#\nprint(1)\n'
    );
    fs.writeFileSync(path.join(dir, 'no-header.ts'), 'export const x = 1\n');
    const missing = findMissingLicenseHeaders(['with-spdx.ts', 'with-apache.py', 'no-header.ts'], dir);
    assert.deepEqual(missing, ['no-header.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findMissingLicenseHeaders 头部检查边界：第 15 行内放行，第 16 行起判缺', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-license-'));
  try {
    const filler = (n) => Array.from({ length: n }, (_, i) => `// line ${i + 1}`).join('\n');
    fs.writeFileSync(path.join(dir, 'at-15.ts'), `${filler(14)}\n// SPDX-License-Identifier: Apache-2.0\n`);
    fs.writeFileSync(path.join(dir, 'at-16.ts'), `${filler(15)}\n// SPDX-License-Identifier: Apache-2.0\n`);
    const missing = findMissingLicenseHeaders(['at-15.ts', 'at-16.ts'], dir);
    assert.deepEqual(missing, ['at-16.ts']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('回归：git 仍跟踪但工作树已删除（未暂存）的文件跳过，不抛 ENOENT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'precis-license-'));
  try {
    fs.mkdirSync(path.join(dir, 'e2e', 'flows'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'e2e', 'flows', 'kept.spec.ts'),
      '// SPDX-License-Identifier: Apache-2.0\nexport {}\n'
    );
    // e2e/flows/deleted.spec.ts 有意不创建——模拟 git 跟踪但工作树已删除未暂存
    const missing = findMissingLicenseHeaders(
      ['e2e/flows/kept.spec.ts', 'e2e/flows/deleted.spec.ts'],
      dir
    );
    assert.deepEqual(missing, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

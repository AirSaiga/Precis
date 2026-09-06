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
import { test, expect } from '../fixtures/base'

/**
 * 项目配置 E2E 测试
 *
 * 覆盖：
 * - 项目清单读取
 * - Schema 列表获取
 * - 配置完整性验证
 */

test.describe('Project Configuration', () => {
  test('project manifest is readable', async ({ testProjectPath }) => {
    const fs = await import('fs')
    const path = await import('path')

    const manifestPath = path.join(testProjectPath, 'project.precis.yaml')
    expect(fs.existsSync(manifestPath)).toBe(true)

    const content = fs.readFileSync(manifestPath, 'utf-8')
    expect(content).toContain('version')
    expect(content).toContain('schemas')
  })

  test('schema files exist', async ({ testProjectPath }) => {
    const fs = await import('fs')
    const path = await import('path')

    const schemaPath = path.join(testProjectPath, 'schemas', 'users.schema.yaml')
    expect(fs.existsSync(schemaPath)).toBe(true)
  })

  test('test data files exist', async ({ testProjectPath }) => {
    const fs = await import('fs')
    const path = await import('path')

    const dataPath = path.join(testProjectPath, 'data', 'users.csv')
    expect(fs.existsSync(dataPath)).toBe(true)

    const content = fs.readFileSync(dataPath, 'utf-8')
    expect(content).toContain('id,name,email')
  })
})

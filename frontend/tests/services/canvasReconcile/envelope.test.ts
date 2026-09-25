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
 * @fileoverview envelope 单元测试：v2 变更集信封的运行时校验全分支
 */
import { describe, it, expect } from 'vitest'
import { parseChangeSetEnvelope } from '@/services/canvasReconcile/envelope'

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    instructionId: 'add:schema:users',
    actionType: 'ADD_SCHEMA',
    op: 'add',
    kind: 'schema',
    entityId: 'users',
    filePath: 'schemas/users.schema.yaml',
    ...overrides,
  }
}

describe('parseChangeSetEnvelope', () => {
  it('合法信封（六字段齐全）解析为强类型对象', () => {
    const env = parseChangeSetEnvelope(makeEnvelope())
    expect(env).toEqual({
      instructionId: 'add:schema:users',
      actionType: 'ADD_SCHEMA',
      op: 'add',
      kind: 'schema',
      entityId: 'users',
      filePath: 'schemas/users.schema.yaml',
    })
  })

  it('容忍未知额外字段（契约"只增不减"承诺）', () => {
    const env = parseChangeSetEnvelope(makeEnvelope({ extraField: 'whatever' }))
    expect(env).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['非对象字符串', 'add:schema:users'],
    [
      '缺 instructionId',
      { op: 'add', kind: 'schema', entityId: 'x', filePath: 'p', actionType: 'A' },
    ],
    [
      '缺 actionType',
      { instructionId: 'i', op: 'add', kind: 'schema', entityId: 'x', filePath: 'p' },
    ],
    [
      '缺 entityId',
      { instructionId: 'i', actionType: 'A', op: 'add', kind: 'schema', filePath: 'p' },
    ],
    [
      '缺 filePath',
      { instructionId: 'i', actionType: 'A', op: 'add', kind: 'schema', entityId: 'x' },
    ],
  ])('非法输入（%s）返回 null', (_name, value) => {
    expect(parseChangeSetEnvelope(value)).toBeNull()
  })

  it.each(['upsert', 'delete', '', 'ADD'])('非法 op 枚举（%s）返回 null', (op) => {
    expect(parseChangeSetEnvelope(makeEnvelope({ op }))).toBeNull()
  })

  it.each(['schemas', 'datasource', '', 'Constraint'])('非法 kind 枚举（%s）返回 null', (kind) => {
    expect(parseChangeSetEnvelope(makeEnvelope({ kind }))).toBeNull()
  })

  it('接受全部合法 kind（含预留的 manualData/template）', () => {
    for (const kind of ['schema', 'constraint', 'regex', 'transform', 'manualData', 'template']) {
      expect(parseChangeSetEnvelope(makeEnvelope({ kind }))).not.toBeNull()
    }
  })

  it.each(['add', 'update', 'remove'])('接受全部合法 op（%s）', (op) => {
    expect(parseChangeSetEnvelope(makeEnvelope({ op }))).not.toBeNull()
  })
})

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
 * @fileoverview dateLogic handler targetType 分流回归测试
 *
 * 重点回归（B4）：calculation 模式的 target_value / target_column 分流不再依赖
 * 无生产者的 targetType 字段，改为按 targetValue 有无推导（与 UI 一致）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Node, Edge } from '@vue-flow/core'
import { getHandlerByKind } from '@/services/constraints/validationRegistryCore'
import type { ConstraintValidationContext } from '@/services/constraints/types'

// 触发 handler 自注册（side-effect import）
import '@/services/constraints/validationRegistryHandlers/dateLogicHandler'

vi.mock('@/api/validationApi', () => ({
  validateDateLogic: vi.fn(),
  validateInline: vi.fn(),
}))

import { validateDateLogic, validateInline } from '@/api/validationApi'

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'node-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {},
    ...overrides,
  } as Node
}

function makeEdge(overrides: Partial<Edge> = {}): Edge {
  return {
    id: 'edge-1',
    source: 'schema-1',
    target: 'constraint-1',
    sourceHandle: 'source-right-col-1',
    targetHandle: 'target-left',
    ...overrides,
  } as Edge
}

function makeFileModeCtx(constraintData: Record<string, unknown>): ConstraintValidationContext {
  return {
    nodes: [],
    schemaNode: makeNode({ id: 'schema-1' }),
    constraintNode: makeNode({
      id: 'constraint-1',
      type: 'dateLogicConstraint',
      data: constraintData,
    }),
    edge: makeEdge(),
    columnId: 'col-1',
    columnName: 'birth_date',
    sourceFilePath: '/data/users.csv',
    sourceFile: 'users.csv',
    sheetName: 'Sheet1',
    headerRow: 0,
  } as unknown as ConstraintValidationContext
}

function makeInlineModeCtx(constraintData: Record<string, unknown>): ConstraintValidationContext {
  return {
    nodes: [],
    schemaNode: makeNode({ id: 'schema-1' }),
    constraintNode: makeNode({
      id: 'constraint-1',
      type: 'dateLogicConstraint',
      data: constraintData,
    }),
    edge: makeEdge(),
    columnId: 'col-1',
    columnName: 'birth_date',
    columnDataType: 'date',
    inlineRows: [['1990-01-01']],
    inlineColumnNames: ['birth_date'],
  } as unknown as ConstraintValidationContext
}

const okResponse = {
  success: true,
  validation_type: 'date_logic',
  data: {
    is_valid: true,
    error_count: 0,
    total_rows: 1,
    error_rows: [],
    validation_time: '2026-01-01T00:00:00Z',
  },
  error: null,
}

describe('dateLogic handler calculation 模式 target 分流', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(validateDateLogic).mockResolvedValue(okResponse as never)
    vi.mocked(validateInline).mockResolvedValue(okResponse as never)
  })

  it('文件路径模式：有 targetValue 时发 target_value（不依赖 targetType）', async () => {
    const handler = getHandlerByKind('dateLogic')
    expect(handler).not.toBeNull()

    const result = await handler!.validate(
      makeFileModeCtx({
        logicMode: 'calculation',
        calculationType: 'age',
        targetValue: '18',
        // targetType 缺失（无生产者）——旧逻辑会误走 target_column 分支
      })
    )

    expect(result.status).toBe('pass')
    expect(validateDateLogic).toHaveBeenCalledWith(
      expect.objectContaining({
        validation_config: expect.objectContaining({ target_value: '18' }),
      })
    )
    const request = vi.mocked(validateDateLogic).mock.calls[0]![0]
    expect(request.validation_config).not.toHaveProperty('target_column')
  })

  it('文件路径模式：无 targetValue 时发 target_column', async () => {
    const handler = getHandlerByKind('dateLogic')

    const result = await handler!.validate(
      makeFileModeCtx({
        logicMode: 'calculation',
        calculationType: 'age',
        targetColumn: 'age_col',
      })
    )

    expect(result.status).toBe('pass')
    expect(validateDateLogic).toHaveBeenCalledWith(
      expect.objectContaining({
        validation_config: expect.objectContaining({ target_column: 'age_col' }),
      })
    )
  })

  it('行内模式：有 targetValue 时发 target_value', async () => {
    const handler = getHandlerByKind('dateLogic')

    const result = await handler!.validate(
      makeInlineModeCtx({
        logicMode: 'calculation',
        calculationType: 'days_diff',
        targetValue: '30',
      })
    )

    expect(result.status).toBe('pass')
    expect(validateInline).toHaveBeenCalledWith(
      expect.objectContaining({
        validation_config: expect.objectContaining({ target_value: '30' }),
      })
    )
  })

  it('行内模式：无 targetValue 时发 target_column', async () => {
    const handler = getHandlerByKind('dateLogic')

    const result = await handler!.validate(
      makeInlineModeCtx({
        logicMode: 'calculation',
        calculationType: 'days_diff',
        targetColumn: 'ref_col',
      })
    )

    expect(result.status).toBe('pass')
    expect(validateInline).toHaveBeenCalledWith(
      expect.objectContaining({
        validation_config: expect.objectContaining({ target_column: 'ref_col' }),
      })
    )
  })
})

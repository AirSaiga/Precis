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
 * @fileoverview requireSource 数据源闸门单元测试
 *
 * 红线回归：V2 导入的 Schema 只写 sourceFilePath/localPath 不写 sourceFile
 * （sourceFile 仅数据源连线/绑定场景写入的展示名），requireSource 过去要求
 * sourceFile 与 sourceFilePath 同时存在，导致 V2 导入的约束全部 idle。
 * 修复后闸门只要求后端真正使用的 sourceFilePath。
 */

import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@vue-flow/core'
import {
  requireSource,
  requestFailureResult,
  clientNoticeResult,
  toResult,
} from '@/services/constraints/validationHelpers'
import type { ConstraintValidationContext } from '@/services/constraints/types'

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'node-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {},
    ...overrides,
  } as Node
}

function makeEdge(): Edge {
  return {
    id: 'edge-1',
    source: 'schema-1',
    target: 'constraint-1',
    sourceHandle: 'source-right-col-1',
    targetHandle: 'target-left',
  } as Edge
}

function makeCtx(
  overrides: Partial<ConstraintValidationContext> = {}
): ConstraintValidationContext {
  return {
    nodes: [],
    schemaNode: makeNode({ id: 'schema-1' }),
    constraintNode: makeNode({ id: 'constraint-1', type: 'notNullConstraint' }),
    edge: makeEdge(),
    columnId: 'col-1',
    columnName: 'email',
    ...overrides,
  } as ConstraintValidationContext
}

describe('requireSource - 数据源闸门', () => {
  it('V2 导入 shape（仅 sourceFilePath，无 sourceFile）放行校验', () => {
    const ctx = makeCtx({ sourceFilePath: 'D:/proj/data/users.csv' })
    expect(requireSource(ctx)).toBeNull()
  })

  it('inlineRows 存在时无需文件路径（TransformOutput/ManualData）', () => {
    const ctx = makeCtx({ inlineRows: [['v1'], ['v2']] })
    expect(requireSource(ctx)).toBeNull()
  })

  it('sourceFile 与 sourceFilePath 齐备（数据源连线场景）放行校验', () => {
    const ctx = makeCtx({ sourceFile: 'users.csv', sourceFilePath: 'D:/proj/data/users.csv' })
    expect(requireSource(ctx)).toBeNull()
  })

  it('无任何路径时返回 idle（校验跳过）', () => {
    const ctx = makeCtx({})
    const result = requireSource(ctx)
    expect(result).toEqual({
      status: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    })
  })

  it('仅 sourceFile（展示名）无路径时仍返回 idle——后端按路径加载，展示名不可替代', () => {
    const ctx = makeCtx({ sourceFile: 'users.csv' })
    expect(requireSource(ctx)).not.toBeNull()
    expect(requireSource(ctx)!.status).toBe('idle')
  })

  it('空 inlineRows 数组不视为行内数据源', () => {
    const ctx = makeCtx({ inlineRows: [] })
    expect(requireSource(ctx)!.status).toBe('idle')
  })
})

describe('toResult - 错误行 → 结果（含 i18n localizedErrors）', () => {
  it('带 error_code 的错误行映射为 validation.codes.<CODE>，行号转为 1-based', () => {
    const result = toResult(
      [
        {
          row_index: 0,
          cell_value: '150',
          error_message: '区间约束冲突: 值 150 不在范围 [0, 100] 内。',
          error_code: 'RANGE_VALUE_OUT_OF_RANGE',
          error_params: { value: '150', bounds: '[0, 100]' },
        },
      ],
      3,
      '值超出区间范围'
    )
    expect(result.status).toBe('error')
    expect(result.validationErrors).toEqual([
      '第 1 行: 区间约束冲突: 值 150 不在范围 [0, 100] 内。',
    ])
    expect(result.localizedErrors).toEqual([
      {
        key: 'validation.codes.RANGE_VALUE_OUT_OF_RANGE',
        fallback: '区间约束冲突: 值 150 不在范围 [0, 100] 内。',
        params: { value: '150', bounds: '[0, 100]' },
        row: 1,
      },
    ])
    expect(result.lastValidation).toEqual({ totalRows: 3, errorCount: 1, matchCount: 2 })
  })

  it('无 error_code（旧后端）：key 置空、fallback 用后端 message', () => {
    const result = toResult([{ row_index: 2, cell_value: 'x', error_message: '旧消息' }], 5, '兜底')
    expect(result.localizedErrors![0]).toEqual({
      key: '',
      fallback: '旧消息',
      row: 3,
    })
  })

  it('error_message 缺失：回退 handler 类型级兜底文案', () => {
    const result = toResult([{ row_index: 1, cell_value: '' }], 2, '值超出区间范围')
    expect(result.validationErrors[0]).toBe('第 2 行: 值超出区间范围')
    expect(result.localizedErrors![0].fallback).toBe('值超出区间范围')
  })

  it('零错误行：pass 状态、localizedErrors 为空数组', () => {
    const result = toResult([], 10, '兜底')
    expect(result.status).toBe('pass')
    expect(result.localizedErrors).toEqual([])
    expect(result.lastValidation).toEqual({ totalRows: 10, errorCount: 0, matchCount: 10 })
  })

  it('errorRows 非数组（后端异常载荷）：按零错误处理', () => {
    const result = toResult(undefined, 4, '兜底')
    expect(result.status).toBe('pass')
    expect(result.validationErrors).toEqual([])
  })
})

describe('requestFailureResult / clientNoticeResult - key 化结果构建', () => {
  it('requestFailureResult：按约束种类生成 requestFailed key，detail 携带原始错误', () => {
    const result = requestFailureResult('range', '未找到列: Total')
    expect(result.status).toBe('error')
    expect(result.validationErrors).toEqual(['未找到列: Total'])
    expect(result.localizedErrors).toEqual([
      {
        key: 'validation.range.requestFailed',
        fallback: '未找到列: Total',
        params: { detail: '未找到列: Total' },
      },
    ])
    expect(result.lastValidation).toBeUndefined()
  })

  it('clientNoticeResult：客户端前置校验消息映射为 validation.codes.<CODE>', () => {
    const result = clientNoticeResult('idle', 'FK_TARGET_NOT_SELECTED', '请选择目标列后再进行校验')
    expect(result.status).toBe('idle')
    expect(result.localizedErrors).toEqual([
      { key: 'validation.codes.FK_TARGET_NOT_SELECTED', fallback: '请选择目标列后再进行校验' },
    ])
  })
})

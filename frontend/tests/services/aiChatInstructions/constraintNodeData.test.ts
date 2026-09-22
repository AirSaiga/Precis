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
import { describe, it, expect } from 'vitest'
import { buildConstraintParamsData } from '@/services/aiChatInstructions/constraintNodeData'

describe('buildConstraintParamsData：dateLogic targetValue 双形态', () => {
  it('数值 targetValue（提示词契约）保留为数值，不被 string-only 读取丢弃', () => {
    const data = buildConstraintParamsData('dateLogic', {
      logicMode: 'calculation',
      calculationType: 'age',
      targetValue: 18,
    })
    expect(data.targetValue).toBe(18)
    expect(data.calculationType).toBe('age')
  })

  it('字符串 targetValue 原样保留', () => {
    const data = buildConstraintParamsData('dateLogic', {
      logicMode: 'calculation',
      calculationType: 'days_diff',
      targetValue: '30',
      targetColumn: 'updated_at',
    })
    expect(data.targetValue).toBe('30')
    expect(data.targetColumn).toBe('updated_at')
  })

  it('缺失 targetValue 不产出该键（其余字段照常透传）', () => {
    const data = buildConstraintParamsData('dateLogic', { logicMode: 'calculation' })
    expect('targetValue' in data).toBe(false)
  })
})

describe('buildConstraintParamsData：conditional thenCondition DSL 键名归一', () => {
  it('camelCase refColumn 归一为 ref_column（运行时/GUI/保存三侧只认 snake）', () => {
    const data = buildConstraintParamsData('conditional', {
      thenCondition: { operator: 'greater_than', value: 0, refColumn: 'score' },
    })
    expect(data.thenConditionConfig).toEqual({
      operator: 'greater_than',
      value: 0,
      ref_column: 'score',
    })
  })

  it('snake ref_column 双接受，原样通过', () => {
    const data = buildConstraintParamsData('conditional', {
      thenCondition: { operator: 'not_null', ref_column: 'status' },
    })
    expect(data.thenConditionConfig).toEqual({ operator: 'not_null', ref_column: 'status' })
  })

  it('字符串函数名形态原样保留', () => {
    const data = buildConstraintParamsData('conditional', { thenCondition: 'is_not_empty' })
    expect(data.thenConditionConfig).toBe('is_not_empty')
  })

  it('null/undefined 值被剔除，不写入 DSL', () => {
    const data = buildConstraintParamsData('conditional', {
      thenCondition: { operator: 'in', value: null, values: ['a', 'b'], refColumn: undefined },
    })
    expect(data.thenConditionConfig).toEqual({ operator: 'in', values: ['a', 'b'] })
  })

  it('ifConditions 条目的 ifColumnId 归一为 ref.columnId（保存链路消费形态）', () => {
    const data = buildConstraintParamsData('conditional', {
      thenCondition: 'is_not_empty',
      ifConditions: [
        { ifColumnId: 'col-1', operator: 'eq', value: 'A' },
        { column: '状态', operator: 'not_null' },
      ],
    })
    expect(data.ifConditions).toEqual([
      {
        operator: 'eq',
        value: 'A',
        values: undefined,
        column: undefined,
        ref: { columnId: 'col-1' },
      },
      { operator: 'not_null', value: undefined, values: undefined, column: '状态', ref: undefined },
    ])
  })
})

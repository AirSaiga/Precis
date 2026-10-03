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
 * @file constraintLabel.test.ts
 * @description 约束结构化描述 → 英文标签渲染单测（与后端 CLI 侧 constraint_summaries 口径对位）
 */

import { describe, expect, it } from 'vitest'

import { renderConstraintLabelEn } from '@/services/i18n/constraintLabel'

describe('renderConstraintLabelEn', () => {
  it('renders NotNull with table.column', () => {
    expect(renderConstraintLabelEn({ kind: 'NotNull', table: 'orders', column: 'order_id' })).toBe(
      'NotNull: orders.order_id'
    )
  })

  it('renders Unique with joined columns', () => {
    expect(
      renderConstraintLabelEn({ kind: 'Unique', table: 'orders', columns: ['order_id', 'line_no'] })
    ).toBe('Unique: orders.order_id, line_no')
  })

  it('renders AllowedValues full and truncated at five', () => {
    expect(
      renderConstraintLabelEn({
        kind: 'AllowedValues',
        table: 't',
        column: 'c',
        allowed_values: ['a', 'b'],
      })
    ).toBe("AllowedValues: t.c allowed ['a', 'b']")
    expect(
      renderConstraintLabelEn({
        kind: 'AllowedValues',
        table: 't',
        column: 'c',
        allowed_values: ['a', 'b', 'c', 'd', 'e', 'f'],
      })
    ).toBe("AllowedValues: t.c allowed ['a', 'b', 'c', 'd', 'e']...")
  })

  it('renders Range bounds in both boundary modes and single-bound forms', () => {
    expect(
      renderConstraintLabelEn({
        kind: 'Range',
        table: 't',
        column: 'c',
        min: 0,
        max: 100,
        boundary_mode: 'inclusive',
      })
    ).toBe('Range: t.c range [0, 100]')
    expect(
      renderConstraintLabelEn({
        kind: 'Range',
        table: 't',
        column: 'c',
        min: 0,
        max: 100,
        boundary_mode: 'exclusive',
      })
    ).toBe('Range: t.c range (0, 100)')
    expect(renderConstraintLabelEn({ kind: 'Range', table: 't', column: 'c', min: 1 })).toBe(
      'Range: t.c >= 1'
    )
    expect(
      renderConstraintLabelEn({
        kind: 'Range',
        table: 't',
        column: 'c',
        max: 9,
        boundary_mode: 'exclusive',
      })
    ).toBe('Range: t.c < 9')
    expect(renderConstraintLabelEn({ kind: 'Range', table: 't', column: 'c' })).toBe('Range: t.c')
  })

  it('renders ForeignKey with arrow', () => {
    expect(
      renderConstraintLabelEn({
        kind: 'ForeignKey',
        from_table: 'orders',
        from_column: 'customer_id',
        to_table: 'customers',
        to_column: 'customer_id',
      })
    ).toBe('ForeignKey: orders.customer_id -> customers.customer_id')
  })

  it('renders Regex pattern, Charset modes, Scripted name', () => {
    expect(
      renderConstraintLabelEn({ kind: 'Regex', table: 't', column: 'c', pattern: '^\\d+$' })
    ).toBe("Regex: t.c pattern='^\\d+$'")
    expect(
      renderConstraintLabelEn({
        kind: 'Charset',
        table: 't',
        column: 'c',
        charset_mode: 'chinese_mixed',
      })
    ).toBe('Charset: t.c (Chinese (mixed))')
    expect(renderConstraintLabelEn({ kind: 'Scripted', table: 't', name: 'rule1' })).toBe(
      'Scripted: t.rule1'
    )
  })

  it('renders Conditional in simple and composite trigger modes', () => {
    expect(
      renderConstraintLabelEn({
        kind: 'Conditional',
        table: 't',
        then_column: 'credit_limit',
        then: { operator: 'greater_than', value: 1000 },
        if_column: 'status',
        if_value: 'VIP',
        if_conditions: [],
      })
    ).toBe(
      "Conditional: t when status=VIP, credit_limit must satisfy DSL {'operator': 'greater_than', 'value': 1000}"
    )
    expect(
      renderConstraintLabelEn({
        kind: 'Conditional',
        table: 't',
        then_column: 'c',
        then: 'is_not_empty',
        if_conditions: [{ column: 'age', operator: 'greater_than', value: 18 }],
      })
    ).toBe("Conditional: t when the condition holds, c must satisfy registered rule 'is_not_empty'")
  })

  it('renders DateLogic compare and calculation modes', () => {
    expect(
      renderConstraintLabelEn({
        kind: 'DateLogic',
        table: 't',
        column: 'birth',
        logic_mode: 'compare',
        compare_op: 'gt',
        reference_date: '1900-01-01',
      })
    ).toBe('DateLogic: t.birth gt 1900-01-01')
    expect(
      renderConstraintLabelEn({
        kind: 'DateLogic',
        table: 't',
        column: 'birth',
        logic_mode: 'calculation',
        calculation_type: 'age',
      })
    ).toBe('DateLogic: t.birth age check')
  })

  it('renders Composite with logic and sub count', () => {
    expect(
      renderConstraintLabelEn({ kind: 'Composite', table: null, logic: 'any', sub_count: 3 })
    ).toBe('Composite (logic=any, 3 sub-constraints)')
  })

  it('returns null for missing/unknown input so callers fall back to message', () => {
    expect(renderConstraintLabelEn(null)).toBeNull()
    expect(renderConstraintLabelEn(undefined)).toBeNull()
    expect(renderConstraintLabelEn({ kind: 'Future', table: 't' })).toBeNull()
    // 关键字段缺失（NotNull 无 column / ForeignKey 缺 to_table）
    expect(renderConstraintLabelEn({ kind: 'NotNull', table: 't' })).toBeNull()
    expect(
      renderConstraintLabelEn({
        kind: 'ForeignKey',
        from_table: 'a',
        from_column: 'x',
        to_column: 'y',
      })
    ).toBeNull()
  })
})

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
import type { ConstraintRowEntry } from '@/stores/graphStore/modules/constraintDensity'
import {
  TABLE_LEVEL_SECTION_KEY,
  flattenSchemaColumnsForOverview,
  groupConstraintRowsByColumn,
  aggregateStatusCounts,
  type ConstraintOverviewColumnRef,
} from '@/services/constraints/constraintOverview'

function row(
  overrides: Partial<ConstraintRowEntry> & { constraintId: string }
): ConstraintRowEntry {
  return {
    kind: 'notNull',
    label: overrides.constraintId,
    embedded: false,
    ...overrides,
  }
}

describe('flattenSchemaColumnsForOverview', () => {
  it('schema 平铺列按原序输出 {id, name}', () => {
    const cols = [
      { id: 'a', columnName: 'col_a' },
      { id: 'b', columnName: '' },
    ]
    expect(flattenSchemaColumnsForOverview(cols)).toEqual([
      { id: 'a', name: 'col_a' },
      { id: 'b', name: 'b' }, // 列名缺失回退 id
    ])
  })

  it('jsonSchema 嵌套子列深度优先先序展开（父列后紧跟其子列）', () => {
    const cols = [
      {
        id: 'root',
        columnName: 'root',
        children: [
          { id: 'c1', columnName: 'child1' },
          {
            id: 'c2',
            columnName: 'child2',
            children: [{ id: 'c2a', columnName: 'grandchild' }],
          },
        ],
      },
      { id: 'other', columnName: 'other' },
    ]
    expect(flattenSchemaColumnsForOverview(cols).map((c) => c.id)).toEqual([
      'root',
      'c1',
      'c2',
      'c2a',
      'other',
    ])
  })

  it('undefined / 空数组返回空清单', () => {
    expect(flattenSchemaColumnsForOverview(undefined)).toEqual([])
    expect(flattenSchemaColumnsForOverview([])).toEqual([])
  })
})

describe('groupConstraintRowsByColumn', () => {
  const columns: ConstraintOverviewColumnRef[] = [
    { id: 'col-a', name: 'A' },
    { id: 'col-b', name: 'B' },
    { id: 'col-c', name: 'C' },
  ]
  const idleStatus = () => ({ status: 'idle' as const, errorCount: 0 })

  it('按列序分组；无约束列跳过；columnId 缺失沉底为表级小节', () => {
    const rows = [
      row({ constraintId: 'r2', columnId: 'col-b', kind: 'range' }),
      row({ constraintId: 'r1', columnId: 'col-a' }),
      row({ constraintId: 'r-table' }), // 无 columnId → 表级
    ]
    const sections = groupConstraintRowsByColumn(rows, columns, idleStatus)
    expect(sections.map((s) => s.key)).toEqual(['col-a', 'col-b', TABLE_LEVEL_SECTION_KEY])
    expect(sections[0]).toMatchObject({ title: 'A', isTableLevel: false })
    expect(sections[2]).toMatchObject({ key: TABLE_LEVEL_SECTION_KEY, isTableLevel: true })
    expect(sections[2]!.chips.map((c) => c.constraintId)).toEqual(['r-table'])
  })

  it('同列内保持行派生顺序（内嵌先独立后）；chip 携带运行态快照', () => {
    const rows = [
      row({
        constraintId: 'inline-x',
        columnId: 'col-a',
        kind: 'unique',
        embedded: true,
        label: 'unique',
      }),
      row({ constraintId: 'standalone-y', columnId: 'col-a', kind: 'scripted', label: 'Y' }),
    ]
    const sections = groupConstraintRowsByColumn(rows, columns, (r) =>
      r.embedded ? { status: null, errorCount: 0 } : { status: 'error', errorCount: 7 }
    )
    expect(sections).toHaveLength(1)
    expect(sections[0]!.chips.map((c) => c.constraintId)).toEqual(['inline-x', 'standalone-y'])
    expect(sections[0]!.chips[0]).toMatchObject({ embedded: true, status: null, errorCount: 0 })
    expect(sections[0]!.chips[1]).toMatchObject({ embedded: false, status: 'error', errorCount: 7 })
  })

  it('悬挂列（columnId 指向已删除列）归入表级小节', () => {
    const rows = [row({ constraintId: 'dangling', columnId: 'col-gone' })]
    const sections = groupConstraintRowsByColumn(rows, columns, idleStatus)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.isTableLevel).toBe(true)
  })

  it('空行清单返回空小节（表级也不出现）', () => {
    expect(groupConstraintRowsByColumn([], columns, idleStatus)).toEqual([])
  })
})

describe('aggregateStatusCounts', () => {
  it('三桶计数：pass / error / 未校验（idle+missing 合并）；内嵌（null）不计入', () => {
    const chips = [
      { constraintId: '1', status: 'pass', errorCount: 0 },
      { constraintId: '2', status: 'pass', errorCount: 0 },
      { constraintId: '3', status: 'error', errorCount: 5 },
      { constraintId: '4', status: 'idle', errorCount: 0 },
      { constraintId: '5', status: 'missing', errorCount: 0 },
      { constraintId: '6', status: null, errorCount: 0 },
    ].map((c) => ({
      kind: 'notNull',
      label: c.constraintId,
      embedded: c.status === null,
      ...c,
    }))
    expect(aggregateStatusCounts(chips)).toEqual({ pass: 2, error: 1, pending: 2 })
  })

  it('空清单全零', () => {
    expect(aggregateStatusCounts([])).toEqual({ pass: 0, error: 0, pending: 0 })
  })
})

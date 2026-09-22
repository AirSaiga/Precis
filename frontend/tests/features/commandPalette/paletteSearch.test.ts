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
import { describe, it, expect, vi } from 'vitest'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import {
  buildNodeSearchEntries,
  filterPaletteEntries,
  revealAndFocusNode,
} from '@/features/command-palette/services/paletteSearch'

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  extra: { hidden?: boolean } = {}
): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    hidden: extra.hidden,
    data: data as CustomNodeData,
  } as CustomNode
}

const TYPE_LABELS = { notNullConstraint: '非空' }

describe('buildNodeSearchEntries', () => {
  it('纯 UI 节点（constraintDock / patternToolbox / constraintDashboard）不进结果', () => {
    const entries = buildNodeSearchEntries(
      [
        makeNode('dock-1', 'constraintDock', { configName: '坞' }),
        makeNode('toolbox-1', 'patternToolbox', { patterns: [] }),
        makeNode('dashboard-1', 'constraintDashboard', { items: [] }),
        makeNode('schema-1', 'schema', { configName: 'users' }),
      ],
      { typeLabels: TYPE_LABELS }
    )
    expect(entries.map((e) => e.nodeId)).toEqual(['schema-1'])
  })

  it('Schema 条目：主标签 configName，可检索表名与列名', () => {
    const entries = buildNodeSearchEntries(
      [
        makeNode('schema-1', 'schema', {
          configName: '客户表',
          tableName: 'customers',
          columns: [
            { id: 'c1', columnName: 'email' },
            { id: 'c2', columnName: 'phone' },
          ],
        }),
      ],
      { typeLabels: TYPE_LABELS }
    )
    const entry = entries[0]
    expect(entry.primaryLabel).toBe('客户表')
    expect(entry.secondaryLabel).toBe('')
    expect(entry.searchText).toContain('customers')
    expect(entry.searchText).toContain('email')
    expect(entry.searchText).toContain('phone')
  })

  it('约束条目：主标签回退类型显示名，次标签解析所属 Schema，可检索类型名与列字段', () => {
    const entries = buildNodeSearchEntries(
      [
        makeNode('schema-1', 'schema', { configName: '客户表', tableName: 'customers' }),
        makeNode('c-1', 'notNullConstraint', {
          sourceRef: { nodeId: 'schema-1', columnId: 'c1' },
          table: 'customers',
          column: 'email',
        }),
      ],
      { typeLabels: TYPE_LABELS }
    )
    const entry = entries[1]
    expect(entry.primaryLabel).toBe('非空')
    expect(entry.secondaryLabel).toBe('客户表')
    expect(entry.searchText).toContain('非空')
    expect(entry.searchText).toContain('email')
    expect(entry.searchText).toContain('notnullconstraint')
  })

  it('约束 configName 优先于类型显示名作为主标签', () => {
    const entries = buildNodeSearchEntries(
      [makeNode('c-1', 'notNullConstraint', { configName: '邮箱非空' })],
      { typeLabels: TYPE_LABELS }
    )
    expect(entries[0].primaryLabel).toBe('邮箱非空')
  })

  it('sourceRef 指向已删除 Schema 时次标签为空串（不崩溃）', () => {
    const entries = buildNodeSearchEntries(
      [makeNode('c-1', 'notNullConstraint', { sourceRef: { nodeId: 'gone', columnId: 'x' } })],
      { typeLabels: TYPE_LABELS }
    )
    expect(entries[0].secondaryLabel).toBe('')
  })

  it('正则条目：可检索 pattern 与描述', () => {
    const entries = buildNodeSearchEntries(
      [
        makeNode('r-1', 'regex', {
          configName: '邮箱校验',
          pattern: '^[a-z]+@[a-z]+\\.[a-z]{2,}$',
          description: '校验邮箱格式',
        }),
      ],
      { typeLabels: TYPE_LABELS }
    )
    expect(entries[0].searchText).toContain('^[a-z]+@[a-z]+\\.[a-z]{2,}$')
    expect(entries[0].searchText).toContain('校验邮箱格式')
  })

  it('projectRoot 条目以 projectName 为主标签', () => {
    const entries = buildNodeSearchEntries(
      [makeNode('root', 'projectRoot', { projectName: '我的项目' })],
      { typeLabels: TYPE_LABELS }
    )
    expect(entries[0].primaryLabel).toBe('我的项目')
  })

  it('hidden 标志随条目携带（供 UI 显示"已隐藏"提示）', () => {
    const entries = buildNodeSearchEntries(
      [makeNode('schema-1', 'schema', { configName: 'users' }, { hidden: true })],
      { typeLabels: TYPE_LABELS }
    )
    expect(entries[0].hidden).toBe(true)
  })
})

describe('filterPaletteEntries（大小写不敏感子串）', () => {
  const rows = [
    { searchText: '客户表 customers email' },
    { searchText: 'orders 订单' },
    { searchText: '非空 notnullconstraint' },
  ]

  it('大写查询命中小写内容', () => {
    expect(filterPaletteEntries(rows, 'CUST')).toHaveLength(1)
    expect(filterPaletteEntries(rows, 'CUST')[0].searchText).toContain('customers')
  })

  it('中文子串命中', () => {
    expect(filterPaletteEntries(rows, '订单')).toHaveLength(1)
  })

  it('空 / 纯空白查询返回全部', () => {
    expect(filterPaletteEntries(rows, '')).toHaveLength(3)
    expect(filterPaletteEntries(rows, '   ')).toHaveLength(3)
  })

  it('无命中返回空数组', () => {
    expect(filterPaletteEntries(rows, 'zzz-not-exist')).toHaveLength(0)
  })
})

describe('revealAndFocusNode（隐藏节点揭示路径）', () => {
  it('可见节点：不揭示，标记 VF 选中后直接聚焦', () => {
    const updateNodeData = vi.fn()
    const focusNodes = vi.fn()
    const markSelected = vi.fn()
    revealAndFocusNode('n1', {
      nodes: () => [makeNode('n1', 'schema', {}, { hidden: false })],
      updateNodeData,
      focusNodes,
      markSelected,
    })
    expect(updateNodeData).not.toHaveBeenCalled()
    expect(markSelected).toHaveBeenCalledWith('n1')
    expect(focusNodes).toHaveBeenCalledWith(['n1'])
  })

  it('隐藏节点：先 updateNodeData 揭示再聚焦（坞聚合/筛选隐藏共用此路径）', () => {
    const updateNodeData = vi.fn()
    const focusNodes = vi.fn()
    const markSelected = vi.fn()
    revealAndFocusNode('n1', {
      nodes: () => [makeNode('n1', 'schema', {}, { hidden: true })],
      updateNodeData,
      focusNodes,
      markSelected,
    })
    expect(updateNodeData).toHaveBeenCalledWith('n1', { hidden: false })
    expect(markSelected).toHaveBeenCalledWith('n1')
    expect(focusNodes).toHaveBeenCalledWith(['n1'])
    // 揭示 → 标记选中 → 聚焦 的顺序（选中豁免要求揭示时节点即将成为选中）
    expect(updateNodeData.mock.invocationCallOrder[0]).toBeLessThan(
      markSelected.mock.invocationCallOrder[0]
    )
    expect(markSelected.mock.invocationCallOrder[0]).toBeLessThan(
      focusNodes.mock.invocationCallOrder[0]
    )
  })

  it('节点不存在（已被删除）：无任何副作用', () => {
    const updateNodeData = vi.fn()
    const focusNodes = vi.fn()
    const markSelected = vi.fn()
    revealAndFocusNode('gone', { nodes: () => [], updateNodeData, focusNodes, markSelected })
    expect(updateNodeData).not.toHaveBeenCalled()
    expect(markSelected).not.toHaveBeenCalled()
    expect(focusNodes).not.toHaveBeenCalled()
  })
})

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
 * @file embeddedConstraints.test.ts
 * @description materializeV2EmbeddedConstraints 直接单元测试
 *
 * 验证 V2 schema 内嵌约束的物化行为：节点生成、边建立、去重、列映射。
 * 不 mock buildNodeData，让真实 NodeDataBuilder 管线运行。
 * 覆盖 B3 修复：Conditional/FK 内嵌约束按列 ID 直通（保存→物化 roundtrip）、
 * skip_if/allow_null 开关持久化、旧格式（无 then_column_id/skip_if）兼容。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CustomNode } from '@/types/graph'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import { buildEmbeddedConstraintItem } from '@/services/persistence/embedders/embeddedConstraintBuilder'

// 工厂函数（遵循 AGENTS.md 测试规范）
function makeSchemaNode(overrides?: Partial<CustomNode>): CustomNode {
  return {
    id: 'schema-users',
    type: 'schema',
    position: { x: 100, y: 100 },
    data: {
      configName: 'users',
      saveState: 'saved',
      tableName: 'users',
      columns: [
        { id: 'col-email', columnName: 'email' },
        { id: 'col-country', columnName: 'country' },
        { id: 'col-idcard', columnName: 'id_card' },
        { id: 'col-uid', columnName: 'user_id' },
      ],
    } as CustomNode['data'],
    ...overrides,
  }
}

/** 物化辅助：收集节点与边 */
function runMaterialize(
  schemaNode: CustomNode,
  embeddedConstraints: Parameters<
    typeof materializeV2EmbeddedConstraints
  >[0]['embeddedConstraints'],
  colNameToId: Map<string, string>
) {
  const addedNodes: CustomNode[] = []
  const addedEdges: Array<{ tableId: string; constraintId: string; columnId: string }> = []
  materializeV2EmbeddedConstraints({
    schemaNode,
    schemaTableName: 'users',
    embeddedConstraints,
    colNameToId,
    hasNode: () => false,
    addNode: (node) => addedNodes.push(node),
    addConstraintEdge: (tableId, constraintId, columnId) =>
      addedEdges.push({ tableId, constraintId, columnId }),
  })
  return { addedNodes, addedEdges }
}

describe('materializeV2EmbeddedConstraints', () => {
  let addedNodes: CustomNode[]
  let addedEdges: Array<{ tableId: string; constraintId: string; columnId: string }>
  let existingIds: Set<string>

  beforeEach(() => {
    addedNodes = []
    addedEdges = []
    existingIds = new Set()
  })

  it('物化 NotNull 内嵌约束 → 生成约束节点与约束边', () => {
    const schemaNode = makeSchemaNode()
    const colNameToId = new Map([['email', 'col-email']])

    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: 'users',
      embeddedConstraints: [{ id: 'nn_email', type: 'NotNull', column: 'email' }],
      colNameToId,
      hasNode: (id) => existingIds.has(id),
      addNode: (node) => addedNodes.push(node),
      addConstraintEdge: (tableId, constraintId, columnId) =>
        addedEdges.push({ tableId, constraintId, columnId }),
    })

    expect(addedNodes).toHaveLength(1)
    // 节点类型映射正确
    expect(addedNodes[0].type).toBe('notNullConstraint')
    // id 带有 schema 前缀
    expect(addedNodes[0].id).toBe('schema-users_nn_email')
    // 位置基于 schema 节点偏移
    expect(addedNodes[0].position.x).toBe(520) // 100 + 420
    // 至少建立一条约束边
    expect(addedEdges.length).toBeGreaterThanOrEqual(1)
    expect(addedEdges[0].columnId).toBe('col-email')
    expect(addedEdges[0].tableId).toBe('schema-users')
  })

  it('物化 Conditional 内嵌约束 → then_column_id/if_column_id 按列 ID 直通', () => {
    const schemaNode = makeSchemaNode()
    const colNameToId = new Map([
      ['country', 'col-country'],
      ['id_card', 'col-idcard'],
    ])

    const { addedNodes, addedEdges } = runMaterialize(
      schemaNode,
      [
        {
          id: 'cond_idcard',
          type: 'Conditional',
          refs: {
            then_column_id: 'col-idcard',
            if_conditions: [{ if_column_id: 'col-country', operator: 'eq', value: 'CN' }],
            if_logic: 'and',
          },
          params: { then_condition: { operator: 'not_null' } },
        },
      ],
      colNameToId
    )

    expect(addedNodes).toHaveLength(1)
    expect(addedNodes[0].type).toBe('conditionalConstraint')
    expect(addedNodes[0].id).toBe('schema-users_cond_idcard')
    // THEN/IF 列 ID 直通（UUID 不再被当作列名查 colNameToId 而丢失）
    const data = addedNodes[0].data as Record<string, unknown>
    expect((data.thenRef as { columnId: string }).columnId).toBe('col-idcard')
    expect((data.thenRef as { columnName: string }).columnName).toBe('id_card')
    const ifConditions = data.ifConditions as Array<{
      ref?: { columnId: string }
      columnId?: string
      column?: string
    }>
    expect(ifConditions[0].ref?.columnId ?? ifConditions[0].columnId).toBe('col-country')
    expect(ifConditions[0].column).toBe('country')
    // THEN 边 + IF 边
    expect(addedEdges).toHaveLength(2)
    expect(addedEdges.map((e) => e.columnId).sort()).toEqual(['col-country', 'col-idcard'])
  })

  it('已存在的 id（含前缀）会被去重跳过', () => {
    const schemaNode = makeSchemaNode()
    // 模拟该节点已存在于画布
    existingIds.add('schema-users_nn_email')

    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: 'users',
      embeddedConstraints: [{ id: 'nn_email', type: 'NotNull', column: 'email' }],
      colNameToId: new Map([['email', 'col-email']]),
      hasNode: (id) => existingIds.has(id),
      addNode: (node) => addedNodes.push(node),
      addConstraintEdge: vi.fn(),
    })

    expect(addedNodes).toHaveLength(0)
  })

  it('无 id 的内嵌约束被跳过', () => {
    const schemaNode = makeSchemaNode()

    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: 'users',
      embeddedConstraints: [{ type: 'NotNull', column: 'email' }],
      colNameToId: new Map(),
      hasNode: () => false,
      addNode: (node) => addedNodes.push(node),
      addConstraintEdge: vi.fn(),
    })

    expect(addedNodes).toHaveLength(0)
  })

  it('id 已含 schema 前缀时不重复添加前缀', () => {
    const schemaNode = makeSchemaNode()

    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: 'users',
      embeddedConstraints: [{ id: 'schema-users_nn_email', type: 'NotNull', column: 'email' }],
      colNameToId: new Map([['email', 'col-email']]),
      hasNode: () => false,
      addNode: (node) => addedNodes.push(node),
      addConstraintEdge: vi.fn(),
    })

    expect(addedNodes).toHaveLength(1)
    expect(addedNodes[0].id).toBe('schema-users_nn_email')
  })

  it('物化多个约束 → 生成多个节点且位置按索引递增', () => {
    const schemaNode = makeSchemaNode()
    const colNameToId = new Map([
      ['email', 'col-email'],
      ['name', 'col-name'],
    ])

    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: 'users',
      embeddedConstraints: [
        { id: 'nn_email', type: 'NotNull', column: 'email' },
        { id: 'nn_name', type: 'NotNull', column: 'name' },
      ],
      colNameToId,
      hasNode: () => false,
      addNode: (node) => addedNodes.push(node),
      addConstraintEdge: vi.fn(),
    })

    expect(addedNodes).toHaveLength(2)
    // 第二个节点 y 坐标比第一个大 160（idx * 160）
    expect(addedNodes[1].position.y).toBe(addedNodes[0].position.y + 160)
  })
})

// ============================================================================
// B3: 保存 → 物化 roundtrip（嵌入式 Conditional / ForeignKey）
// ============================================================================

function makeConditionalNode(): CustomNode {
  return {
    id: 'cond-1',
    type: 'conditionalConstraint',
    position: { x: 0, y: 0 },
    data: {
      configName: '身份证规则',
      enabled: true,
      table: 'users',
      ifLogic: 'or',
      thenRef: { nodeId: 'schema-users', columnId: 'col-idcard' },
      thenColumn: 'id_card',
      thenConditionConfig: { operator: 'not_null' },
      skipIfCondition: true,
      ifConditions: [
        {
          operator: 'eq',
          value: 'CN',
          ref: { nodeId: 'schema-users', columnId: 'col-country' },
          column: 'country',
        },
        {
          operator: 'in',
          values: ['CN', 'HK'],
          ref: { nodeId: 'schema-users', columnId: 'col-email' },
          column: 'email',
        },
      ],
    } as CustomNode['data'],
  }
}

function makeFkNode(): CustomNode {
  return {
    id: 'fk-1',
    type: 'foreignKeyConstraint',
    position: { x: 0, y: 0 },
    data: {
      configName: 'FK 用户订单',
      enabled: true,
      sourceTable: 'users',
      sourceColumn: 'user_id',
      targetTable: 'orders',
      targetColumn: 'id',
      allowNull: true,
      sourceRef: { nodeId: 'schema-users', columnId: 'col-uid' },
      targetRef: { nodeId: 'schema-orders', columnId: 'col-order-id' },
      validationStatus: 'idle',
    } as CustomNode['data'],
  }
}

describe('B3 保存→物化 roundtrip', () => {
  it('Conditional：IF 两条件 + THEN 列按 ID roundtrip，列引用不丢', () => {
    const schemaNode = makeSchemaNode()
    const item = buildEmbeddedConstraintItem(makeConditionalNode())

    // 保存侧键名契约（与独立路径一致）
    expect(item.column).toBe('col-idcard')
    expect(item.params?.then_column_id).toBe('col-idcard')
    expect(item.params?.skip_if).toBe(true)
    expect(item.params?.if_logic).toBe('or')
    expect(item.params?.if_conditions).toEqual([
      { if_column_id: 'col-country', operator: 'eq', value: 'CN', values: undefined },
      {
        if_column_id: 'col-email',
        operator: 'in',
        value: undefined,
        values: ['CN', 'HK'],
      },
    ])

    // 物化：then_column_id / if_column_id 按列 ID 直通
    const { addedNodes, addedEdges } = runMaterialize(schemaNode, [item], new Map())
    expect(addedNodes).toHaveLength(1)

    const data = addedNodes[0].data as Record<string, unknown>
    expect((data.thenRef as { columnId: string; columnName: string }).columnId).toBe('col-idcard')
    expect((data.thenRef as { columnId: string; columnName: string }).columnName).toBe('id_card')
    const ifConditions = data.ifConditions as Array<{
      ref?: { columnId: string }
      column?: string
    }>
    expect(ifConditions).toHaveLength(2)
    expect(ifConditions[0].ref?.columnId).toBe('col-country')
    expect(ifConditions[0].column).toBe('country')
    expect(ifConditions[1].ref?.columnId).toBe('col-email')
    expect(ifConditions[1].column).toBe('email')
    // skip_if 开关不复位
    expect(data.skipIfCondition).toBe(true)
    expect(data.ifLogic).toBe('or')
    // THEN 边 + 两条 IF 边
    expect(addedEdges.map((e) => e.columnId).sort()).toEqual([
      'col-country',
      'col-email',
      'col-idcard',
    ])
  })

  it('ForeignKey：from/to 表列名 + allow_null roundtrip，开关不复位', () => {
    const schemaNode = makeSchemaNode()
    const item = buildEmbeddedConstraintItem(makeFkNode())

    // 保存侧键名契约（与独立路径 params.allow_null 一致）
    expect(item.from_table).toBe('users')
    expect(item.from_column).toBe('user_id')
    expect(item.to_table).toBe('orders')
    expect(item.to_column).toBe('id')
    expect(item.params).toEqual({ allow_null: true })

    // 物化：宿主 schema 为 from_table，源列名解析回列 ID；跨表目标按名保留
    const colNameToId = new Map([['user_id', 'col-uid']])
    const { addedNodes, addedEdges } = runMaterialize(schemaNode, [item], colNameToId)
    expect(addedNodes).toHaveLength(1)
    expect(addedNodes[0].type).toBe('foreignKeyConstraint')

    const data = addedNodes[0].data as Record<string, unknown>
    expect(data.sourceTable).toBe('users')
    expect(data.sourceColumn).toBe('user_id')
    expect(data.targetTable).toBe('orders')
    expect(data.targetColumn).toBe('id')
    // allow_null 开关不复位
    expect(data.allowNull).toBe(true)
    expect(data.sourceRef).toEqual({ nodeId: 'schema-users', columnId: 'col-uid' })
    // 跨表目标无节点访问能力 → 置空待独立导入路径恢复
    expect(data.targetRef).toEqual({ nodeId: '', columnId: '' })
    expect(data.embedded).toBe(true)
    // 仅源约束边（不建 FK 展示边）
    expect(addedEdges).toEqual([
      { tableId: 'schema-users', constraintId: 'schema-users_fk-1', columnId: 'col-uid' },
    ])
  })

  it('Conditional 不勾选 skip_if 时 params 不写 skip_if 键', () => {
    const node = makeConditionalNode()
    ;(node.data as Record<string, unknown>).skipIfCondition = false
    const item = buildEmbeddedConstraintItem(node)
    expect(item.params?.skip_if).toBeUndefined()
  })

  it('ForeignKey allowNull 非 true 时 params 不写 allow_null 键', () => {
    const node = makeFkNode()
    ;(node.data as Record<string, unknown>).allowNull = false
    const item = buildEmbeddedConstraintItem(node)
    expect(item.params).toEqual({})
  })
})

// ============================================================================
// B3: 旧格式兼容（磁盘存量 YAML：无 then_column_id / 无 skip_if / 列名为列名）
// ============================================================================

describe('B3 旧格式兼容', () => {
  it('旧格式 Conditional（column 为列 ID、无 then_column_id/skip_if）物化不崩', () => {
    const schemaNode = makeSchemaNode()
    const { addedNodes, addedEdges } = runMaterialize(
      schemaNode,
      [
        {
          id: 'cond_old',
          type: 'Conditional',
          column: 'col-idcard',
          params: {
            then_condition: { operator: 'not_null' },
            if_logic: 'or',
            if_conditions: [{ if_column_id: 'col-country', operator: 'eq', value: 'CN' }],
          },
        },
      ],
      new Map()
    )

    expect(addedNodes).toHaveLength(1)
    const data = addedNodes[0].data as Record<string, unknown>
    // THEN 回退读 base.column（旧保存侧写入的列 ID）
    expect((data.thenRef as { columnId: string }).columnId).toBe('col-idcard')
    const ifConditions = data.ifConditions as Array<{ ref?: { columnId: string } }>
    expect(ifConditions[0].ref?.columnId).toBe('col-country')
    // 无 skip_if → 开关复位为 false（默认），不崩溃
    expect(data.skipIfCondition).toBe(false)
    expect(addedEdges.map((e) => e.columnId).sort()).toEqual(['col-country', 'col-idcard'])
  })

  it('手写格式 Conditional（then_column_id/column 为列名）经 colNameToId 兜底解析', () => {
    const schemaNode = makeSchemaNode()
    const colNameToId = new Map([
      ['country', 'col-country'],
      ['id_card', 'col-idcard'],
    ])
    const { addedNodes } = runMaterialize(
      schemaNode,
      [
        {
          id: 'cond_name',
          type: 'Conditional',
          column: 'id_card',
          params: {
            then_condition: { operator: 'not_null' },
            if_conditions: [{ if_column_id: 'country', operator: 'eq', value: 'CN' }],
          },
        },
      ],
      colNameToId
    )

    expect(addedNodes).toHaveLength(1)
    const data = addedNodes[0].data as Record<string, unknown>
    expect((data.thenRef as { columnId: string }).columnId).toBe('col-idcard')
    const ifConditions = data.ifConditions as Array<{ ref?: { columnId: string } }>
    expect(ifConditions[0].ref?.columnId).toBe('col-country')
  })

  it('旧格式 ForeignKey（仅 from/to 表列名、无 params）物化不崩', () => {
    const schemaNode = makeSchemaNode()
    const { addedNodes, addedEdges } = runMaterialize(
      schemaNode,
      [
        {
          id: 'fk_old',
          type: 'ForeignKey',
          from_table: 'users',
          from_column: 'user_id',
          to_table: 'orders',
          to_column: 'id',
        },
      ],
      new Map([['user_id', 'col-uid']])
    )

    expect(addedNodes).toHaveLength(1)
    const data = addedNodes[0].data as Record<string, unknown>
    expect(data.sourceTable).toBe('users')
    expect(data.sourceColumn).toBe('user_id')
    expect(data.targetTable).toBe('orders')
    expect(data.targetColumn).toBe('id')
    expect(data.allowNull).toBe(false)
    expect(data.sourceRef).toEqual({ nodeId: 'schema-users', columnId: 'col-uid' })
    expect(addedEdges).toEqual([
      { tableId: 'schema-users', constraintId: 'schema-users_fk_old', columnId: 'col-uid' },
    ])
  })
})

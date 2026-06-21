/**
 * @file embeddedConstraints.test.ts
 * @description materializeV2EmbeddedConstraints 直接单元测试
 *
 * 验证 V2 schema 内嵌约束的物化行为：节点生成、边建立、去重、列映射。
 * 不 mock buildNodeData，让真实 NodeDataBuilder 管线运行。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CustomNode } from '@/types/graph'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'

// 工厂函数（遵循 AGENTS.md 测试规范）
function makeSchemaNode(overrides?: Partial<CustomNode>): CustomNode {
  return {
    id: 'schema-users',
    type: 'schema',
    position: { x: 100, y: 100 },
    data: { configName: 'users', saveState: 'saved' } as CustomNode['data'],
    ...overrides,
  }
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

  it('物化 Conditional 内嵌约束 → 生成 conditional 节点', () => {
    const schemaNode = makeSchemaNode()
    const colNameToId = new Map([
      ['country', 'col-country'],
      ['id_card', 'col-idcard'],
    ])

    materializeV2EmbeddedConstraints({
      schemaNode,
      schemaTableName: 'users',
      embeddedConstraints: [
        {
          id: 'cond_idcard',
          type: 'Conditional',
          refs: {
            then_column_id: 'id_card',
            if_conditions: [{ if_column_id: 'country', operator: 'eq', value: 'CN' }],
            if_logic: 'and',
          },
          params: { then_condition: { operator: 'not_null' } },
        },
      ],
      colNameToId,
      hasNode: () => false,
      addNode: (node) => addedNodes.push(node),
      addConstraintEdge: (tableId, constraintId, columnId) =>
        addedEdges.push({ tableId, constraintId, columnId }),
    })

    expect(addedNodes).toHaveLength(1)
    expect(addedNodes[0].type).toBe('conditionalConstraint')
    expect(addedNodes[0].id).toBe('schema-users_cond_idcard')
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

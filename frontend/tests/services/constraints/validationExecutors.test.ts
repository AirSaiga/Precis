/**
 * @fileoverview validationExecutors 列错误同步单元测试
 *
 * 测试 rebuildAllColumnErrors（Bug 3.4 修复）：
 * - 单约束校验后全列重建，清除其他列的 stale 错误
 * - 约束 sourceRef 变更后，旧列错误被正确清除
 */

import { describe, it, expect } from 'vitest'
import { rebuildAllColumnErrors } from '@/services/constraints/validationRegistry'

function makeNodes() {
  return [
    {
      id: 'schema-1',
      type: 'schema',
      data: {
        tableName: 'users',
        columns: [
          { id: 'col-a', columnName: 'A', validationErrors: ['old error A'] },
          { id: 'col-b', columnName: 'B', validationErrors: ['old error B'] },
          { id: 'col-c', columnName: 'C', validationErrors: [] },
        ],
      },
    },
    // 约束节点：现在指向 col-b（sourceRef 已从 col-a 迁移到 col-b）
    {
      id: 'notnull-1',
      type: 'notNullConstraint',
      data: {
        sourceRef: { nodeId: 'schema-1', columnId: 'col-b' },
        validationErrors: ['new error B'],
      },
    },
  ] as any[]
}

describe('validationExecutors - rebuildAllColumnErrors (Bug 3.4)', () => {
  it('重建后 col-a 的 stale 错误被清除，col-b 写入新错误', () => {
    const nodes = makeNodes()
    const updates: Record<string, unknown> = {}
    const updateNodeData = (nodeId: string, data: Record<string, unknown>) => {
      updates[nodeId] = data
      // 同步回 nodes 以模拟 store 行为（rebuild 读取的就是最新 columns）
      const node = nodes.find((n) => n.id === nodeId)
      if (node) node.data = { ...node.data, ...data }
    }

    rebuildAllColumnErrors('schema-1', nodes, updateNodeData)

    const updatedColumns = (
      updates['schema-1'] as { columns: Array<{ validationErrors: string[] }> }
    ).columns
    // col-a 不再被任何约束引用 → 错误应被清空（Bug 3.4 的核心）
    expect(updatedColumns[0].validationErrors).toEqual([])
    // col-b 被引用 → 写入新错误
    expect(updatedColumns[1].validationErrors).toEqual(['new error B'])
    // col-c 无约束引用 → 保持空
    expect(updatedColumns[2].validationErrors).toEqual([])
  })

  it('Schema 不存在时安全返回（不抛错）', () => {
    const updateNodeData = () => {}
    expect(() => rebuildAllColumnErrors('nonexistent', [], updateNodeData)).not.toThrow()
  })

  it('Schema 无列时安全返回', () => {
    const nodes = [{ id: 'schema-empty', type: 'schema', data: { columns: [] } }] as any[]
    const updateNodeData = () => {}
    expect(() => rebuildAllColumnErrors('schema-empty', nodes, updateNodeData)).not.toThrow()
  })
})

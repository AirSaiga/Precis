/**
 * @fileoverview validationExecutors 列错误同步与断连重置单元测试
 *
 * 覆盖三个纯逻辑函数：
 * - rebuildAllColumnErrors（Bug 3.4 修复）：全列重建，清除 stale 错误
 * - syncColumnErrorsForSourceRef：单列错误同步（仅刷指定列）
 * - resetDownstreamValidationStatus：断连后重置下游约束节点的校验状态
 */

import { describe, it, expect } from 'vitest'
import {
  rebuildAllColumnErrors,
  syncColumnErrorsForSourceRef,
  resetDownstreamValidationStatus,
} from '@/services/constraints/validationRegistry'

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

describe('validationExecutors - syncColumnErrorsForSourceRef', () => {
  it('仅同步指定列的错误（不影响其他列）', () => {
    const nodes = [
      {
        id: 'schema-1',
        type: 'schema',
        data: {
          columns: [
            { id: 'col-a', columnName: 'A', validationErrors: ['old A'] },
            { id: 'col-b', columnName: 'B', validationErrors: ['old B'] },
          ],
        },
      },
      {
        id: 'notnull-1',
        type: 'notNullConstraint',
        data: {
          sourceRef: { nodeId: 'schema-1', columnId: 'col-b' },
          validationErrors: ['new error B'],
        },
      },
    ] as any[]

    const updates: Record<string, unknown> = {}
    const updateNodeData = (nodeId: string, data: Record<string, unknown>) => {
      updates[nodeId] = data
    }

    syncColumnErrorsForSourceRef('schema-1', 'col-b', nodes, updateNodeData)

    const updatedColumns = (
      updates['schema-1'] as { columns: Array<{ id: string; validationErrors: string[] }> }
    ).columns
    // col-a 不受影响（保持原值）
    expect(updatedColumns[0].validationErrors).toEqual(['old A'])
    // col-b 写入新错误
    expect(updatedColumns[1].validationErrors).toEqual(['new error B'])
  })

  it('Schema 不存在时安全返回', () => {
    expect(() => syncColumnErrorsForSourceRef('nonexistent', 'col-a', [], () => {})).not.toThrow()
  })

  it('无匹配约束时该列错误为空', () => {
    const nodes = [
      {
        id: 'schema-1',
        type: 'schema',
        data: { columns: [{ id: 'col-a', columnName: 'A', validationErrors: ['old'] }] },
      },
    ] as any[]
    const updates: Record<string, unknown> = {}
    syncColumnErrorsForSourceRef('schema-1', 'col-a', nodes, (id, data) => {
      updates[id] = data
    })
    const updatedColumns = (
      updates['schema-1'] as { columns: Array<{ validationErrors: string[] }> }
    ).columns
    expect(updatedColumns[0].validationErrors).toEqual([])
  })
})

describe('validationExecutors - resetDownstreamValidationStatus', () => {
  it('重置 schema 下游约束节点的校验状态', () => {
    const nodes = [
      { id: 'schema-1', type: 'schema', data: {} },
      {
        id: 'notnull-1',
        type: 'notNullConstraint',
        data: { validationStatus: 'error', validationErrors: ['err'], lastValidation: 123 },
      },
    ] as any[]
    const edges = [{ id: 'e1', source: 'schema-1', target: 'notnull-1' }] as any[]

    const updates: Record<string, unknown> = {}
    resetDownstreamValidationStatus('schema-1', nodes, edges, (id, data) => {
      updates[id] = data
    })

    // notnull-1 应被重置
    expect(updates['notnull-1']).toBeDefined()
    const resetData = updates['notnull-1'] as Record<string, unknown>
    // 重置后状态应为 idle/disconnected（非 error）
    expect(resetData.validationStatus).not.toBe('error')
  })

  it('Schema 无下游边时安全返回', () => {
    const nodes = [{ id: 'schema-1', type: 'schema', data: {} }] as any[]
    const updates: Record<string, unknown> = {}
    resetDownstreamValidationStatus('schema-1', nodes, [], (id, data) => {
      updates[id] = data
    })
    expect(Object.keys(updates)).toHaveLength(0)
  })

  it('目标节点不是约束类型时跳过', () => {
    const nodes = [
      { id: 'schema-1', type: 'schema', data: {} },
      { id: 'other-1', type: 'transform', data: {} },
    ] as any[]
    const edges = [{ id: 'e1', source: 'schema-1', target: 'other-1' }] as any[]
    const updates: Record<string, unknown> = {}
    resetDownstreamValidationStatus('schema-1', nodes, edges, (id, data) => {
      updates[id] = data
    })
    expect(Object.keys(updates)).toHaveLength(0)
  })
})

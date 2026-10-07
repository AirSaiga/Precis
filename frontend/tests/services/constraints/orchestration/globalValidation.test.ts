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
 * @fileoverview globalValidation 校验编排入口行为级测试（画布校验执行链路）
 *
 * 覆盖三条公共入口的行为契约：
 * - validateAllConstraints：数据源闸门（未连接跳过 + 防御性重置）、委托批量校验
 * - triggerValidationForNode：非阻塞触发，异步失败仅记日志不上抛
 * - dispatchValidation：单约束即时校验的边匹配（sourceHandle + 目标节点类型过滤）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  validateAllConstraints,
  triggerValidationForNode,
  dispatchValidation,
} from '@/services/constraints/orchestration/globalValidation'

// ============================================================================
// Mock 外部边界：校验注册表（编排层测试只关心委托关系与参数，不测真实校验）
// ============================================================================

vi.mock('@/services/constraints/validationRegistry', () => ({
  validateConstraintNodesForSchema: vi.fn(),
  validateConstraintNode: vi.fn(),
  getConstraintMetaByKind: vi.fn(),
  syncColumnErrorsForSourceRef: vi.fn(),
  resetDownstreamValidationStatus: vi.fn(),
}))

import {
  validateConstraintNodesForSchema,
  validateConstraintNode,
  getConstraintMetaByKind,
  syncColumnErrorsForSourceRef,
  resetDownstreamValidationStatus,
} from '@/services/constraints/validationRegistry'

// ============================================================================
// 测试数据工厂
// ============================================================================

function makeConnectedGraph() {
  const schemaNode = {
    id: 'schema-1',
    type: 'schema',
    data: {
      tableName: 'users',
      sourceNodeId: 'preview-1',
      columns: [{ id: 'col-a', columnName: 'A', dataType: 'string' }],
    },
  }
  const previewNode = {
    id: 'preview-1',
    type: 'sourcePreview',
    data: { localPath: 'D:/data/users.csv', sourceName: 'users.csv' },
  }
  const constraintNode = { id: 'nn-1', type: 'notNullConstraint', data: {} }
  const edge = {
    id: 'e1',
    source: 'schema-1',
    target: 'nn-1',
    sourceHandle: 'source-right-col-a',
    targetHandle: 'target-left',
  }
  return {
    schemaNode,
    previewNode,
    constraintNode,
    edge,
    nodes: [schemaNode, previewNode, constraintNode],
    edges: [edge],
  }
}

const emptySummary = {
  totalConstraints: 0,
  validConstraints: 0,
  invalidConstraints: 0,
  totalErrors: 0,
  skippedConstraints: 0,
}

// ============================================================================
// validateAllConstraints
// ============================================================================

describe('globalValidation - validateAllConstraints（全表校验入口）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Schema 已连接数据源时委托 validateConstraintNodesForSchema 并透传 summary', async () => {
    const graph = makeConnectedGraph()
    const delegatedSummary = { ...emptySummary, totalConstraints: 1, validConstraints: 1 }
    vi.mocked(validateConstraintNodesForSchema).mockResolvedValue(delegatedSummary)

    const summary = await validateAllConstraints('schema-1', graph.nodes, graph.edges, vi.fn())

    expect(summary).toBe(delegatedSummary)
    expect(validateConstraintNodesForSchema).toHaveBeenCalledTimes(1)
    expect(validateConstraintNodesForSchema).toHaveBeenCalledWith(
      expect.objectContaining({ schemaNodeId: 'schema-1', nodes: graph.nodes, edges: graph.edges })
    )
    // 已连接数据源：不应触发防御性重置
    expect(resetDownstreamValidationStatus).not.toHaveBeenCalled()
  })

  it('未连接数据源时跳过校验并防御性重置下游状态（Bug 2.2 防幽灵校验）', async () => {
    // Schema 只有 V2 导入残留的缓存路径，画布上无 sourceNodeId 引用、无数据源入边
    const schemaNode = {
      id: 'schema-1',
      type: 'schema',
      data: { tableName: 'users', localPath: 'D:/stale.csv', sourceNodeId: 'gone-1' },
    }
    const constraintNode = { id: 'nn-1', type: 'notNullConstraint', data: {} }
    const edge = { id: 'e1', source: 'schema-1', target: 'nn-1' }
    const updateNodeData = vi.fn()

    const summary = await validateAllConstraints(
      'schema-1',
      [schemaNode, constraintNode],
      [edge],
      updateNodeData
    )

    expect(summary).toEqual(emptySummary)
    expect(validateConstraintNodesForSchema).not.toHaveBeenCalled()
    expect(resetDownstreamValidationStatus).toHaveBeenCalledWith(
      'schema-1',
      [schemaNode, constraintNode],
      [edge],
      updateNodeData
    )
  })

  it('数据源节点存在但既无 localPath 也无 sourceFilePath 时同样跳过', async () => {
    // preview 节点 data 为空：sourceFilePath 兜底 '' → falsy，视为未连接
    const schemaNode = {
      id: 'schema-1',
      type: 'schema',
      data: { sourceNodeId: 'preview-1' },
    }
    const previewNode = { id: 'preview-1', type: 'sourcePreview', data: {} }

    const summary = await validateAllConstraints('schema-1', [schemaNode, previewNode], [], vi.fn())

    expect(summary).toEqual(emptySummary)
    expect(validateConstraintNodesForSchema).not.toHaveBeenCalled()
    expect(resetDownstreamValidationStatus).toHaveBeenCalled()
  })
})

// ============================================================================
// triggerValidationForNode
// ============================================================================

describe('globalValidation - triggerValidationForNode（非阻塞触发）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('已连接数据源时异步触发全表校验', async () => {
    const graph = makeConnectedGraph()
    vi.mocked(validateConstraintNodesForSchema).mockResolvedValue({
      ...emptySummary,
      totalConstraints: 1,
    })

    triggerValidationForNode('schema-1', graph.nodes, graph.edges, vi.fn())
    // 微任务排空后委托调用已发生
    await Promise.resolve()

    expect(validateConstraintNodesForSchema).toHaveBeenCalledTimes(1)
  })

  it('校验拒绝时不上抛（非阻塞契约），仅记 error 日志', async () => {
    const graph = makeConnectedGraph()
    vi.mocked(validateConstraintNodesForSchema).mockRejectedValue(new Error('backend down'))

    expect(() =>
      triggerValidationForNode('schema-1', graph.nodes, graph.edges, vi.fn())
    ).not.toThrow()
    // 等待 catch 分支的微任务执行完毕，避免悬挂 rejection
    await Promise.resolve()
    await Promise.resolve()
  })
})

// ============================================================================
// dispatchValidation
// ============================================================================

describe('globalValidation - dispatchValidation（单约束即时校验）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getConstraintMetaByKind).mockReturnValue({ nodeType: 'notNullConstraint' } as never)
    vi.mocked(validateConstraintNode).mockResolvedValue(undefined)
  })

  it('命中 Schema 列 → 约束边时执行单约束校验并同步列错误', async () => {
    const graph = makeConnectedGraph()

    await dispatchValidation('notNull', 'schema-1', 'col-a', graph.nodes, graph.edges, vi.fn())

    expect(validateConstraintNode).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaNode: graph.schemaNode,
        constraintNode: graph.constraintNode,
        edge: graph.edge,
        nodes: graph.nodes,
      })
    )
    // 校验后同步该列错误到 Schema
    expect(syncColumnErrorsForSourceRef).toHaveBeenCalledWith(
      'schema-1',
      'col-a',
      graph.nodes,
      expect.any(Function)
    )
  })

  it('未连接数据源时跳过并防御性重置（不执行单约束校验）', async () => {
    const schemaNode = { id: 'schema-1', type: 'schema', data: {} }
    const updateNodeData = vi.fn()

    await dispatchValidation('notNull', 'schema-1', 'col-a', [schemaNode], [], updateNodeData)

    expect(validateConstraintNode).not.toHaveBeenCalled()
    expect(resetDownstreamValidationStatus).toHaveBeenCalledWith(
      'schema-1',
      [schemaNode],
      [],
      updateNodeData
    )
  })

  it('Schema 节点不存在时静默返回', async () => {
    const graph = makeConnectedGraph()
    // schemaNodeId 不匹配任何节点（getSchemaNodeSourceInfo 命中入边分支也找不到 schema）
    await dispatchValidation('notNull', 'nonexistent', 'col-a', graph.nodes, graph.edges, vi.fn())
    expect(validateConstraintNode).not.toHaveBeenCalled()
  })

  it('sourceHandle 不匹配指定列的边被过滤（不校验）', async () => {
    const graph = makeConnectedGraph()
    // 边连的是 col-b，请求校验 col-a
    graph.edge.sourceHandle = 'source-right-col-b'

    await dispatchValidation('notNull', 'schema-1', 'col-a', graph.nodes, graph.edges, vi.fn())

    expect(validateConstraintNode).not.toHaveBeenCalled()
    expect(syncColumnErrorsForSourceRef).not.toHaveBeenCalled()
  })

  it('目标节点类型与约束类型不符的边被过滤（按 meta.nodeType）', async () => {
    const graph = makeConnectedGraph()
    // 请求 unique，但边上目标节点是 notNullConstraint
    vi.mocked(getConstraintMetaByKind).mockReturnValue({ nodeType: 'uniqueConstraint' } as never)

    await dispatchValidation('unique', 'schema-1', 'col-a', graph.nodes, graph.edges, vi.fn())

    expect(validateConstraintNode).not.toHaveBeenCalled()
  })

  it('目标节点已删除（边悬挂）时静默返回', async () => {
    const graph = makeConnectedGraph()
    const nodesWithoutConstraint = graph.nodes.filter((n) => n.id !== 'nn-1')

    await dispatchValidation(
      'notNull',
      'schema-1',
      'col-a',
      nodesWithoutConstraint,
      graph.edges,
      vi.fn()
    )

    expect(validateConstraintNode).not.toHaveBeenCalled()
  })

  it('单约束校验抛错时上抛（调用方负责 toast/日志）', async () => {
    const graph = makeConnectedGraph()
    vi.mocked(validateConstraintNode).mockRejectedValue(new Error('network down'))

    await expect(
      dispatchValidation('notNull', 'schema-1', 'col-a', graph.nodes, graph.edges, vi.fn())
    ).rejects.toThrow('network down')
    // 抛错路径不应同步列错误（结果未知）
    expect(syncColumnErrorsForSourceRef).not.toHaveBeenCalled()
  })
})

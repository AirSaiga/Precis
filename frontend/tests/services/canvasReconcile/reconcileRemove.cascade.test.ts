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
 * @fileoverview 对账 remove 级联路径集成测试：真实 nodeOps 工厂（注入最小
 * nodes/edges ref）+ mock vueFlowApi 边界，验证 remove 信封走
 * collectCascadeNodeIds → 逐条 removeEdges → removeNodes 级联清理范本。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { createNodeOpsModule } from '@/stores/graphStore/modules/nodeOps'
import { executeReconcilePlan } from '@/services/canvasReconcile/executor'
import { planFromChangeSet } from '@/services/canvasReconcile/planFromChangeSet'
import type { ChangeSetEnvelope } from '@/services/canvasReconcile/envelope'
import type { CustomNode, CustomNodeData } from '@/types/graph'

// mock 边界：vueFlowApi（外部 Vue Flow 依赖），不 mock 被测的 nodeOps 工厂内部
const mocks = vi.hoisted(() => ({
  removeEdges: vi.fn((edgeId: string) => {
    // 边界行为仿真：真实验证链路里 removeEdges 同步触发 onEdgesChange → edges 数组剔除
    if (edgesRef) edgesRef.value = edgesRef.value.filter((e) => e.id !== edgeId)
  }),
  removeNodes: vi.fn((ids: string[] | string) => {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids])
    if (nodesRef) nodesRef.value = nodesRef.value.filter((n) => !idSet.has(n.id))
  }),
  updateNode: vi.fn(),
}))

// 供 mock 边界同步剔定的响应式引用（在测试内赋值）
let nodesRef: Ref<CustomNode[]> | null = null
let edgesRef: Ref<Edge[]> | null = null

vi.mock('@/services/canvas/vueFlowApi', () => ({
  removeEdges: mocks.removeEdges,
  removeNodes: mocks.removeNodes,
  updateNode: mocks.updateNode,
}))

vi.mock('@/api/projectV2Api', () => ({
  deleteV2ManifestTemplateInstanceRef: vi.fn(async () => undefined),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as CustomNodeData } as CustomNode
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target }
}

function makeRemoveEnvelope(
  entityId: string,
  kind: ChangeSetEnvelope['kind'] = 'schema'
): ChangeSetEnvelope {
  return {
    instructionId: `remove:${kind}:${entityId}`,
    actionType: 'DELETE_SCHEMA',
    op: 'remove',
    kind,
    entityId,
    filePath: `${kind}s/${entityId}.yaml`,
  }
}

/** 组装真实 nodeOps 工厂 + 以其为 remove 依赖的执行器 */
async function makeReconcileWithRealNodeOps() {
  const nodes = ref<CustomNode[]>([])
  const edges = ref<Edge[]>([])
  nodesRef = nodes
  edgesRef = edges
  const selectedNodeId = ref<string | null>(null)
  const selectedNodeIds = ref<string[]>([])
  const reconcileAll = vi.fn(async () => {})

  const nodeOps = createNodeOpsModule({
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    reconcileAll,
    templateExpand: { getExpandedIds: () => [] },
    clearExpansion: vi.fn(),
  })

  const deps = {
    nodes: () => nodes.value.map((n) => ({ id: n.id, position: n.position })),
    importV2ResourceToCanvas: vi.fn(async () => null),
    deleteNode: nodeOps.deleteNode,
    positionFor: () => ({ x: 0, y: 0 }),
  }
  return { nodes, edges, selectedNodeId, selectedNodeIds, reconcileAll, nodeOps, deps }
}

describe('对账 remove 级联路径（真实 nodeOps 工厂）', () => {
  beforeEach(() => {
    mocks.removeEdges.mockClear()
    mocks.removeNodes.mockClear()
    mocks.updateNode.mockClear()
  })

  it('remove 信封：先逐条 removeEdges 清关联边，再 removeNodes 删节点', async () => {
    const ctx = await makeReconcileWithRealNodeOps()
    ctx.nodes.value = [
      makeNode('root', 'projectRoot'),
      makeNode('users', 'schema'),
      makeNode('c1', 'charsetConstraint', { configName: 'c1' }),
    ]
    ctx.edges.value = [makeEdge('e1', 'users', 'c1'), makeEdge('e2', 'root', 'users')]

    const outcome = await executeReconcilePlan(
      planFromChangeSet([makeRemoveEnvelope('users')]),
      ctx.deps
    )

    expect(outcome.removed).toEqual(['users'])
    // 级联范本：关联边先清（e1、e2 均涉及 users），再删节点
    expect(mocks.removeEdges).toHaveBeenCalledTimes(2)
    expect(mocks.removeNodes).toHaveBeenCalledWith(['users'])
    // 边界仿真后数组状态一致：节点与关联边均被剔除
    await nextTick()
    expect(ctx.nodes.value.map((n) => n.id).sort()).toEqual(['c1', 'root'])
    expect(ctx.edges.value).toEqual([])
  })

  it('remove transform 级联收集 transformOutput 子节点', async () => {
    const ctx = await makeReconcileWithRealNodeOps()
    ctx.nodes.value = [
      makeNode('tf1', 'transform', { parentTransformId: 'tf1', outputNodeIds: ['tf-out-1'] }),
      makeNode('tf-out-1', 'transformOutput', { parentTransformId: 'tf1' }),
      makeNode('users', 'schema'),
    ]
    ctx.edges.value = [makeEdge('e1', 'users', 'tf1'), makeEdge('e2', 'tf1', 'tf-out-1')]

    const outcome = await executeReconcilePlan(
      planFromChangeSet([makeRemoveEnvelope('tf1', 'transform')]),
      ctx.deps
    )

    expect(outcome.removed).toEqual(['tf1'])
    expect(mocks.removeNodes).toHaveBeenCalledWith(['tf1', 'tf-out-1'])
    await nextTick()
    expect(ctx.nodes.value.map((n) => n.id)).toEqual(['users'])
    expect(ctx.edges.value).toEqual([])
  })

  it('remove 后 reconcileAll 被调度（连接状态重建）', async () => {
    const ctx = await makeReconcileWithRealNodeOps()
    ctx.nodes.value = [makeNode('users', 'schema')]

    await executeReconcilePlan(planFromChangeSet([makeRemoveEnvelope('users')]), ctx.deps)
    // deleteNode 内部 nextTick 后调度 reconcileAll（防御性异步）
    await new Promise((r) => setTimeout(r, 0))
    expect(ctx.reconcileAll).toHaveBeenCalled()
  })

  it('remove 被选中节点时选择状态被清空（画布选择模型一致性）', async () => {
    const ctx = await makeReconcileWithRealNodeOps()
    ctx.nodes.value = [makeNode('users', 'schema'), makeNode('orders', 'schema')]
    ctx.selectedNodeId.value = 'users'
    ctx.selectedNodeIds.value = ['users']

    await executeReconcilePlan(planFromChangeSet([makeRemoveEnvelope('users')]), ctx.deps)
    await nextTick()

    expect(ctx.selectedNodeId.value).toBeNull()
    expect(ctx.selectedNodeIds.value).toEqual([])
  })
})

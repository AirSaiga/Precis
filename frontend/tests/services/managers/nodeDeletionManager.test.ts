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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { NodeDeletionManager } from '@/services/managers/nodeDeletionManager'
import { constraintDockNodeId } from '@/stores/graphStore/modules/factories/dockFactory'

// graphStore 以共享可变替身注入：NodeDeletionManager 构造时捕获 useGraphStore()，
// 替身内的 nodes/edges/spy 每个用例直接改写即可（同 canvasStore.test 模式）
vi.mock('@/stores/graphStore', async () => {
  const { reactive } = await import('vue')
  const state = reactive({
    nodes: [] as CustomNode[],
    edges: [] as Edge[],
    updateNodeData: vi.fn(),
    deleteNodes: vi.fn(async () => {}),
    deleteNode: vi.fn(async () => {}),
  })
  return { useGraphStore: () => state, __dockCascadeTestState: state }
})

vi.mock('@/i18n', () => ({
  default: { global: { t: (key: string) => key } },
}))

import { __dockCascadeTestState as graphState } from '@/stores/graphStore'

function makeNode(id: string, type: string, data?: Record<string, unknown>): CustomNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: (data ?? {}) as CustomNodeData,
  } as CustomNode
}

describe('NodeDeletionManager schema 删除级联约束坞', () => {
  beforeEach(() => {
    graphState.nodes = []
    graphState.edges = []
    vi.clearAllMocks()
  })

  it('schema 删除时坞随约束子节点一并进批量删除', async () => {
    const dockId = constraintDockNodeId('sc1')
    graphState.nodes = [
      makeNode('sc1', 'schema'),
      makeNode('c1', 'notNullConstraint', {
        configName: 'nn',
        sourceRef: { nodeId: 'sc1', columnId: 'col-a' },
      }),
      makeNode('c2', 'uniqueConstraint', {
        configName: 'uq',
        sourceRef: { nodeId: 'sc1', columnId: 'col-b' },
      }),
      makeNode(dockId, 'constraintDock', { schemaNodeId: 'sc1' }),
    ]

    const manager = NodeDeletionManager.getInstance()
    const result = await manager.delete('sc1')

    expect(result).toBe(true)
    expect(vi.mocked(graphState.deleteNodes)).toHaveBeenCalledTimes(1)
    const batch = vi.mocked(graphState.deleteNodes).mock.calls[0]![0]
    expect(batch).toEqual(['c1', 'c2', dockId, 'sc1'])
  })

  it('画布上不存在坞时批量删除不包含坞 id', async () => {
    graphState.nodes = [makeNode('sc1', 'schema')]

    const manager = NodeDeletionManager.getInstance()
    await manager.delete('sc1')

    const batch = vi.mocked(graphState.deleteNodes).mock.calls[0]![0]
    expect(batch).toEqual(['sc1'])
  })
})

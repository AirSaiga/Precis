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
import { ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import {
  constraintDockNodeId,
  createDockFactoryModule,
} from '@/stores/graphStore/modules/factories/dockFactory'
import { addNodes } from '@/services/canvas/vueFlowApi'

// mock vueFlowApi 边界：addNodes 抛未初始化 → 工厂走数组替换兜底（无头路径）
vi.mock('@/services/canvas/vueFlowApi', () => {
  class VueFlowApiNotInitializedError extends Error {
    constructor(message = 'vueFlowApi 未初始化') {
      super(message)
      this.name = 'VueFlowApiNotInitializedError'
    }
  }
  return {
    VueFlowApiNotInitializedError,
    addNodes: vi.fn(() => {
      throw new VueFlowApiNotInitializedError()
    }),
    removeNodes: vi.fn(),
    updateNode: vi.fn(),
    updateNodeData: vi.fn(),
  }
})

describe('createDockFactoryModule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('连调两次只建一个（幂等），id 确定性派生', async () => {
    const nodes = ref<CustomNode[]>([])
    const factory = createDockFactoryModule({ nodes })

    const input = {
      schemaNodeId: 'sc1',
      configName: 'users',
      rows: [],
      position: { x: 420, y: 0 },
    }
    const id1 = await factory.ensureConstraintDockForSchema(input)
    const id2 = await factory.ensureConstraintDockForSchema(input)

    expect(id1).toBe(constraintDockNodeId('sc1'))
    expect(id2).toBe(id1)
    expect(nodes.value).toHaveLength(1)
    expect(vi.mocked(addNodes)).toHaveBeenCalledTimes(1)
  })

  it('坞节点纯展示属性：无 Handle、draggable/selectable false、saveState saved', async () => {
    const nodes = ref<CustomNode[]>([])
    const factory = createDockFactoryModule({ nodes })

    await factory.ensureConstraintDockForSchema({
      schemaNodeId: 'sc1',
      configName: 'users',
      rows: [{ constraintId: 'c1', kind: 'notNull', label: 'C_c1', embedded: false }],
      position: { x: 0, y: 0 },
    })

    const dock = nodes.value[0]!
    expect(dock.type).toBe('constraintDock')
    expect(dock.draggable).toBe(false)
    expect(dock.selectable).toBe(false)
    const data = dock.data as CustomNodeData & { saveState?: string; expandedAll?: boolean }
    expect(data.saveState).toBe('saved')
    // L2 展开态会话起点：折叠（展开语义由 dockSync 动作翻转，不落盘）
    expect(data.expandedAll).toBe(false)
  })

  it('不同 schema 的坞互不冲突', async () => {
    const nodes = ref<CustomNode[]>([])
    const factory = createDockFactoryModule({ nodes })

    await factory.ensureConstraintDockForSchema({
      schemaNodeId: 'sc1',
      configName: 'a',
      rows: [],
      position: { x: 0, y: 0 },
    })
    await factory.ensureConstraintDockForSchema({
      schemaNodeId: 'sc2',
      configName: 'b',
      rows: [],
      position: { x: 0, y: 100 },
    })

    expect(nodes.value).toHaveLength(2)
    expect(new Set(nodes.value.map((n) => n.id)).size).toBe(2)
  })
})

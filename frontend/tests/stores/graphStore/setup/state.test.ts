import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

// mock vueFlowApi，避免依赖真实 Vue Flow 实例
vi.mock('@/services/canvas/vueFlowApi', () => ({
  updateNodeData: vi.fn(),
  updateNode: vi.fn(),
  VueFlowApiNotInitializedError: class VueFlowApiNotInitializedError extends Error {
    constructor() {
      super('VueFlow API not initialized')
      this.name = 'VueFlowApiNotInitializedError'
    }
  },
}))

import { createGraphStoreState } from '@/stores/graphStore/setup/state'
import {
  updateNodeData as mockUpdateVueFlowNodeData,
  updateNode as mockUpdateVueFlowNode,
  VueFlowApiNotInitializedError,
} from '@/services/canvas/vueFlowApi'
import type { CustomNode } from '@/types/graph'

function makeNode(id: string, data: Record<string, unknown> = {}): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: { type: 'schema', ...data },
  } as unknown as CustomNode
}

describe('createGraphStoreState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('初始状态：nodes/edges 为空数组', () => {
    const state = createGraphStoreState()
    expect(state.nodes.value).toEqual([])
    expect(state.edges.value).toEqual([])
  })

  it('初始状态：selectedNodeId 为 null', () => {
    const state = createGraphStoreState()
    expect(state.selectedNodeId.value).toBeNull()
    expect(state.selectedNodeIds.value).toEqual([])
  })

  it('初始状态：isProjectLoaded 为 false', () => {
    const state = createGraphStoreState()
    expect(state.isProjectLoaded.value).toBe(false)
    expect(state.projectName.value).toBe('')
  })

  it('初始状态：projectConfigStats 全为 0', () => {
    const state = createGraphStoreState()
    const stats = state.projectConfigStats.value
    expect(stats.schemaCount).toBe(0)
    expect(stats.constraintCount).toBe(0)
    expect(stats.regexCount).toBe(0)
    expect(stats.transformCount).toBe(0)
    expect(stats.templateCount).toBe(0)
  })

  it('初始状态：lastFullValidationSummary 为 null', () => {
    const state = createGraphStoreState()
    expect(state.lastFullValidationSummary.value).toBeNull()
    expect(state.lastFullValidationStatistics.value).toBeNull()
  })

  it('setLastFullValidationSummary 更新值', () => {
    const state = createGraphStoreState()
    const summary = { total: 10, passed: 8 } as never
    state.setLastFullValidationSummary(summary)
    expect(state.lastFullValidationSummary.value).toEqual({ total: 10, passed: 8 })
  })

  it('setLastFullValidationStatistics 更新值', () => {
    const state = createGraphStoreState()
    const stats = { errors: 2 } as never
    state.setLastFullValidationStatistics(stats)
    expect(state.lastFullValidationStatistics.value).toEqual({ errors: 2 })
  })

  it('pasteOffset 为固定值 {x:20, y:20}', () => {
    const state = createGraphStoreState()
    expect(state.pasteOffset).toEqual({ x: 20, y: 20 })
  })
})

describe('updateNodeData', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('VueFlow 就绪时调用 vueFlowApi.updateNodeData', () => {
    const state = createGraphStoreState()
    state.nodes.value = [makeNode('n1', { label: 'old' })]

    state.updateNodeData('n1', { label: 'new' })

    expect(mockUpdateVueFlowNodeData).toHaveBeenCalledWith('n1', { label: 'new' })
  })

  it('node 级别属性（hidden）调用 updateNode', () => {
    const state = createGraphStoreState()
    state.nodes.value = [makeNode('n1')]

    state.updateNodeData('n1', { hidden: true })

    expect(mockUpdateVueFlowNode).toHaveBeenCalledWith('n1', { hidden: true })
    expect(mockUpdateVueFlowNodeData).not.toHaveBeenCalled()
  })

  it('node 级别属性（position）调用 updateNode', () => {
    const state = createGraphStoreState()
    state.nodes.value = [makeNode('n1')]

    state.updateNodeData('n1', { position: { x: 100, y: 200 } })

    expect(mockUpdateVueFlowNode).toHaveBeenCalledWith('n1', { position: { x: 100, y: 200 } })
  })

  it('data 和 node 级别属性同时存在时分别调用', () => {
    const state = createGraphStoreState()
    state.nodes.value = [makeNode('n1', { label: 'old' })]

    state.updateNodeData('n1', { label: 'new', hidden: false })

    expect(mockUpdateVueFlowNodeData).toHaveBeenCalledWith('n1', { label: 'new' })
    expect(mockUpdateVueFlowNode).toHaveBeenCalledWith('n1', { hidden: false })
  })

  it('VueFlow 未初始化时回退到直接 store mutation', async () => {
    vi.mocked(mockUpdateVueFlowNodeData).mockImplementation(() => {
      throw new VueFlowApiNotInitializedError()
    })

    const state = createGraphStoreState()
    const node = makeNode('n1', { label: 'old' })
    state.nodes.value = [node]

    state.updateNodeData('n1', { label: 'new' })

    // 直接修改 store 中的节点数据
    expect((state.nodes.value[0].data as Record<string, unknown>).label).toBe('new')
  })

  it('VueFlow 未初始化时 hidden 属性直接写入节点', () => {
    vi.mocked(mockUpdateVueFlowNode).mockImplementation(() => {
      throw new VueFlowApiNotInitializedError()
    })

    const state = createGraphStoreState()
    const node = makeNode('n1')
    state.nodes.value = [node]

    state.updateNodeData('n1', { hidden: true })

    expect(state.nodes.value[0].hidden).toBe(true)
  })

  it('VueFlow 未初始化时 position 属性直接写入节点', () => {
    vi.mocked(mockUpdateVueFlowNode).mockImplementation(() => {
      throw new VueFlowApiNotInitializedError()
    })

    const state = createGraphStoreState()
    const node = makeNode('n1')
    state.nodes.value = [node]

    state.updateNodeData('n1', { position: { x: 50, y: 60 } })

    expect(state.nodes.value[0].position).toEqual({ x: 50, y: 60 })
  })

  it('非 VueFlowApiNotInitializedError 异常向上抛出', () => {
    vi.mocked(mockUpdateVueFlowNodeData).mockImplementation(() => {
      throw new Error('unexpected error')
    })

    const state = createGraphStoreState()
    state.nodes.value = [makeNode('n1')]

    expect(() => state.updateNodeData('n1', { label: 'new' })).toThrow('unexpected error')
  })

  it('nextTick 后同步 store 数据', async () => {
    const state = createGraphStoreState()
    const node = makeNode('n1', { label: 'old' })
    state.nodes.value = [node]

    state.updateNodeData('n1', { label: 'new' })
    await nextTick()

    expect((state.nodes.value[0].data as Record<string, unknown>).label).toBe('new')
  })

  it('节点不存在时 nextTick 后不报错', async () => {
    const state = createGraphStoreState()
    state.nodes.value = []

    // 不应抛出异常
    state.updateNodeData('nonexistent', { label: 'new' })
    await nextTick()
  })
})

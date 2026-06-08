import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createTransformFactoryModule } from '@/stores/graphStore/modules/factories/transformFactory'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

vi.mock('@/i18n', () => ({
  default: { global: { t: (key: string) => key } },
}))

import { addNodes } from '@/services/canvas/vueFlowApi'

describe('transformFactory', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let selectedNodeId: ReturnType<typeof ref<string | null>>
  let factory: ReturnType<typeof createTransformFactoryModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    selectedNodeId = ref<string | null>(null)
    factory = createTransformFactoryModule({ nodes, selectedNodeId })
    vi.mocked(addNodes).mockClear()
  })

  it('返回有效的 nodeId', () => {
    const id = factory.createTransformNode({ x: 10, y: 20 })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('addNodes 被调用，传入节点包含正确的 type', () => {
    factory.createTransformNode({ x: 0, y: 0 })
    expect(addNodes).toHaveBeenCalledTimes(1)
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.type).toBe('transform')
  })

  it('节点 data 默认值正确', () => {
    factory.createTransformNode({ x: 0, y: 0 })
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.data.transformType).toBe('StringSplit')
    expect(node.data.inputFromNode).toBeUndefined()
    expect(node.data.outputColumns).toEqual([])
    expect(node.data.enabled).toBe(true)
    expect(node.data.saveState).toBe('draft')
  })

  it('支持自定义 transformType 和名称', () => {
    factory.createTransformNode({ x: 0, y: 0 }, 'StringReplace', 'MyTransform')
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.data.transformType).toBe('StringReplace')
    expect(node.data.configName).toBe('MyTransform')
  })

  it('selectedNodeId 被自动设置为返回的 id', () => {
    const id = factory.createTransformNode({ x: 0, y: 0 })
    expect(selectedNodeId.value).toBe(id)
  })
})

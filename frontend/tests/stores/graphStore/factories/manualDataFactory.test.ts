import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createManualDataFactoryModule } from '@/stores/graphStore/modules/factories/manualDataFactory'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

vi.mock('@/i18n', () => ({
  default: { global: { t: (key: string) => key } },
}))

import { addNodes } from '@/services/canvas/vueFlowApi'

describe('manualDataFactory', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let selectedNodeId: ReturnType<typeof ref<string | null>>
  let factory: ReturnType<typeof createManualDataFactoryModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    selectedNodeId = ref<string | null>(null)
    factory = createManualDataFactoryModule({ nodes, selectedNodeId })
    vi.mocked(addNodes).mockClear()
  })

  it('返回有效的 nodeId', () => {
    const id = factory.createManualDataNode({ x: 10, y: 20 })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('addNodes 被调用，传入节点包含正确的 type', () => {
    factory.createManualDataNode({ x: 0, y: 0 })
    expect(addNodes).toHaveBeenCalledTimes(1)
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.type).toBe('manualData')
  })

  it('节点 data 默认值正确', () => {
    factory.createManualDataNode({ x: 0, y: 0 })
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.data.columnName).toBe('Column1')
    expect(node.data.rows).toEqual([['value1'], ['value2'], ['value3']])
    expect(node.data.saveState).toBe('draft')
  })

  it('支持自定义 columnName 和 initialRows', () => {
    factory.createManualDataNode({ x: 0, y: 0 }, 'MyCol', [['a'], ['b']])
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.data.columnName).toBe('MyCol')
    expect(node.data.rows).toEqual([['a'], ['b']])
  })

  it('selectedNodeId 被自动设置为返回的 id', () => {
    const id = factory.createManualDataNode({ x: 0, y: 0 })
    expect(selectedNodeId.value).toBe(id)
  })
})

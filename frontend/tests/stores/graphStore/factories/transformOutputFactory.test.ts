import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createTransformOutputFactoryModule } from '@/stores/graphStore/modules/factories/transformOutputFactory'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

import { addNodes } from '@/services/canvas/vueFlowApi'

describe('transformOutputFactory', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let factory: ReturnType<typeof createTransformOutputFactoryModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    factory = createTransformOutputFactoryModule({ nodes })
    vi.mocked(addNodes).mockClear()
  })

  it('返回有效的 nodeId', () => {
    const id = factory.createTransformOutputNode({ x: 10, y: 20 }, 'parent-1', 'col1', [])
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('addNodes 被调用，传入节点包含正确的 type', () => {
    factory.createTransformOutputNode({ x: 0, y: 0 }, 'parent-1', 'col1', [])
    expect(addNodes).toHaveBeenCalledTimes(1)
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.type).toBe('transformOutput')
  })

  it('节点 data 默认值正确', () => {
    const rows = [['a', 'b'], ['c', 'd']]
    factory.createTransformOutputNode({ x: 0, y: 0 }, 'parent-1', 'col1', rows)
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.data.columnName).toBe('col1')
    expect(node.data.configName).toBe('col1')
    expect(node.data.parentTransformId).toBe('parent-1')
    expect(node.data.rows).toEqual(rows)
    expect(node.data.saveState).toBe('draft')
  })

  it('不设置 selectedNodeId（无 selectedNodeId 传入）', () => {
    factory.createTransformOutputNode({ x: 0, y: 0 }, 'parent-1', 'col1', [])
    // 不传 selectedNodeId，autoSelect 不受影响但也不应报错
    expect(addNodes).toHaveBeenCalledTimes(1)
  })
})

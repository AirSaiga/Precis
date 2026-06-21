import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createTemplateInstanceFactoryModule } from '@/stores/graphStore/modules/factories/templateInstanceFactory'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

vi.mock('@/i18n', () => ({
  default: { global: { t: (key: string) => key } },
}))

import { addNodes } from '@/services/canvas/vueFlowApi'

describe('templateInstanceFactory', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let selectedNodeId: ReturnType<typeof ref<string | null>>
  let factory: ReturnType<typeof createTemplateInstanceFactoryModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    selectedNodeId = ref<string | null>(null)
    factory = createTemplateInstanceFactoryModule({ nodes, selectedNodeId })
    vi.mocked(addNodes).mockClear()
  })

  it('返回有效的 nodeId', () => {
    const id = factory.createTemplateInstanceNode({ x: 10, y: 20 })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('addNodes 被调用，传入节点包含正确的 type', () => {
    factory.createTemplateInstanceNode({ x: 0, y: 0 })
    expect(addNodes).toHaveBeenCalledTimes(1)
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.type).toBe('templateInstance')
  })

  it('节点 data 默认值正确', () => {
    factory.createTemplateInstanceNode({ x: 0, y: 0 })
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.data.templateId).toBe('')
    expect(node.data.templateName).toBe('')
    expect(node.data.nodeCount).toBe(0)
    expect(node.data.expanded).toBe(false)
    expect(node.data.saveState).toBe('draft')
    expect(node.data.enabled).toBe(true)
  })

  it('支持自定义参数', () => {
    factory.createTemplateInstanceNode({ x: 0, y: 0 }, 'tpl-1', 'MyTpl', {
      nodeId: 'custom-id',
      enabled: false,
      saveState: 'saved',
    })
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.id).toBe('custom-id')
    expect(node.data.templateId).toBe('tpl-1')
    expect(node.data.templateName).toBe('MyTpl')
    expect(node.data.enabled).toBe(false)
    expect(node.data.saveState).toBe('saved')
  })

  it('autoSelect 为 false 时不设置 selectedNodeId', () => {
    factory.createTemplateInstanceNode({ x: 0, y: 0 }, 'tpl-1', 'MyTpl')
    expect(selectedNodeId.value).toBeNull()
  })
})

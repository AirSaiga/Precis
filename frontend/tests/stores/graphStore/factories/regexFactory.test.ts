import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createRegexFactoryModule } from '@/stores/graphStore/modules/factories/regexFactory'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

vi.mock('@/i18n', () => ({
  default: { global: { t: (key: string) => key } },
}))

import { addNodes } from '@/services/canvas/vueFlowApi'

describe('regexFactory', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let selectedNodeId: ReturnType<typeof ref<string | null>>
  let factory: ReturnType<typeof createRegexFactoryModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    selectedNodeId = ref<string | null>(null)
    factory = createRegexFactoryModule({ nodes, selectedNodeId })
    vi.mocked(addNodes).mockClear()
  })

  it('返回有效的 nodeId', () => {
    const id = factory.createRegexNode({ x: 10, y: 20 })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('addNodes 被调用，传入节点包含正确的 type', () => {
    factory.createRegexNode({ x: 0, y: 0 })
    expect(addNodes).toHaveBeenCalledTimes(1)
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.type).toBe('regex')
  })

  it('节点 data 默认值正确', () => {
    factory.createRegexNode({ x: 0, y: 0 })
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.data.pattern).toBe('^.+$')
    expect(node.data.matchMode).toBe('full')
    expect(node.data.enabled).toBe(true)
    expect(node.data.caseSensitive).toBe(false)
    expect(node.data.validationStatus).toBe('idle')
  })

  it('支持自定义 pattern 和名称', () => {
    factory.createRegexNode({ x: 0, y: 0 }, '^\\d+$', 'DigitPattern')
    const node = vi.mocked(addNodes).mock.calls[0][0]
    expect(node.data.pattern).toBe('^\\d+$')
    expect(node.data.configName).toBe('DigitPattern')
  })

  it('selectedNodeId 被自动设置为返回的 id', () => {
    const id = factory.createRegexNode({ x: 0, y: 0 })
    expect(selectedNodeId.value).toBe(id)
  })
})

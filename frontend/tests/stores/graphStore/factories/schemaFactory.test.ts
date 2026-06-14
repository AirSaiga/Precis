import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createSchemaFactoryModule } from '@/stores/graphStore/modules/factories/schemaFactory'

let capturedNodes: CustomNode[] = []

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn((node: CustomNode | CustomNode[]) => {
    const nodesArray = Array.isArray(node) ? node : [node]
    capturedNodes.push(...nodesArray)
  }),
}))

import { addNodes } from '@/services/canvas/vueFlowApi'

describe('schemaFactory', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let selectedNodeId: ReturnType<typeof ref<string | null>>
  let factory: ReturnType<typeof createSchemaFactoryModule>

  const mockUpdateNodeData = vi.fn((nodeId: string, data: Partial<CustomNode['data']>) => {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (node && node.data) {
      Object.assign(node.data, data)
    }
  })

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    selectedNodeId = ref<string | null>(null)
    factory = createSchemaFactoryModule({
      nodes,
      selectedNodeId,
      updateNodeData: mockUpdateNodeData,
    })
    capturedNodes = []
    vi.mocked(addNodes).mockClear()
    mockUpdateNodeData.mockClear()
  })

  describe('createSchemaNode', () => {
    it('返回有效的 nodeId', () => {
      const id = factory.createSchemaNode({ x: 10, y: 20 })
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('addNodes 被调用，传入节点包含正确的 type', () => {
      factory.createSchemaNode({ x: 0, y: 0 })
      expect(addNodes).toHaveBeenCalledTimes(1)
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.type).toBe('schema')
    })

    it('节点 data 默认值正确', () => {
      factory.createSchemaNode({ x: 0, y: 0 })
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.data.configName).toBe('新Schema配置')
      expect(node.data.tableName).toBe('new_table')
      expect(node.data.sheetName).toBeNull()
      expect(node.data.columns).toEqual([])
      expect(node.data.saveState).toBe('draft')
    })

    it('支持自定义名称', () => {
      factory.createSchemaNode({ x: 0, y: 0 }, 'MySchema')
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.data.configName).toBe('MySchema')
    })

    it('selectedNodeId 被自动设置为返回的 id', () => {
      const id = factory.createSchemaNode({ x: 0, y: 0 })
      expect(selectedNodeId.value).toBe(id)
    })

    it('支持自定义 nodeId', () => {
      const id = factory.createSchemaNode({ x: 0, y: 0 }, undefined, { nodeId: 'custom-schema-id' })
      expect(id).toBe('custom-schema-id')
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.id).toBe('custom-schema-id')
    })

    it('未传入 nodeId 时生成新 id', () => {
      const id = factory.createSchemaNode({ x: 0, y: 0 })
      expect(id).not.toBe('custom-schema-id')
    })
  })

  describe('addColumnToSchema', () => {
    it('节点不存在时不报错', () => {
      expect(() => factory.addColumnToSchema('non-existent')).not.toThrow()
    })

    it('列被正确添加', () => {
      const id = factory.createSchemaNode({ x: 0, y: 0 })
      nodes.value = [...nodes.value, ...capturedNodes]
      factory.addColumnToSchema(id, 'col1', 'String')
      const schemaNode = nodes.value.find((n) => n.id === id)
      expect(schemaNode).toBeDefined()
      expect(schemaNode!.data.columns).toHaveLength(1)
      expect(schemaNode!.data.columns[0].columnName).toBe('col1')
      expect(schemaNode!.data.columns[0].dataType).toBe('String')
    })

    it('saveState 变为 draft', () => {
      const id = factory.createSchemaNode({ x: 0, y: 0 })
      nodes.value = [...nodes.value, ...capturedNodes]
      // 先改成 saved
      const schemaNode = nodes.value.find((n) => n.id === id)!
      schemaNode.data.saveState = 'saved'
      factory.addColumnToSchema(id)
      expect(schemaNode.data.saveState).toBe('draft')
    })
  })
})

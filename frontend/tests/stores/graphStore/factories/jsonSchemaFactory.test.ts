import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createJsonSchemaFactoryModule } from '@/stores/graphStore/modules/factories/jsonSchemaFactory'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

import { addNodes } from '@/services/canvas/vueFlowApi'

describe('jsonSchemaFactory', () => {
  let nodes: ReturnType<typeof ref<CustomNode[]>>
  let selectedNodeId: ReturnType<typeof ref<string | null>>
  let factory: ReturnType<typeof createJsonSchemaFactoryModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    selectedNodeId = ref<string | null>(null)
    factory = createJsonSchemaFactoryModule({ nodes, selectedNodeId })
    vi.mocked(addNodes).mockClear()
  })

  describe('createJsonSchemaNode', () => {
    it('返回有效的 nodeId', () => {
      const id = factory.createJsonSchemaNode({ x: 10, y: 20 })
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('addNodes 被调用，传入节点包含正确的 type', () => {
      factory.createJsonSchemaNode({ x: 0, y: 0 })
      expect(addNodes).toHaveBeenCalledTimes(1)
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.type).toBe('jsonSchema')
    })

    it('节点 data 默认值正确', () => {
      factory.createJsonSchemaNode({ x: 0, y: 0 })
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.data.configName).toBe('新JSON Schema配置')
      expect(node.data.tableName).toBe('json_table')
      expect(node.data.sourceType).toBe('json')
      expect(node.data.columns).toEqual([])
      expect(node.data.saveState).toBe('draft')
    })

    it('支持自定义名称', () => {
      factory.createJsonSchemaNode({ x: 0, y: 0 }, 'MyJson')
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.data.configName).toBe('MyJson')
    })

    it('selectedNodeId 被自动设置为返回的 id', () => {
      const id = factory.createJsonSchemaNode({ x: 0, y: 0 })
      expect(selectedNodeId.value).toBe(id)
    })

    it('支持自定义 nodeId', () => {
      const id = factory.createJsonSchemaNode({ x: 0, y: 0 }, undefined, {
        nodeId: 'custom-json-schema-id',
      })
      expect(id).toBe('custom-json-schema-id')
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.id).toBe('custom-json-schema-id')
    })

    it('未传入 nodeId 时生成新 id', () => {
      const id = factory.createJsonSchemaNode({ x: 0, y: 0 })
      expect(id).not.toBe('custom-json-schema-id')
    })
  })

  describe('createJsonSourcePreviewNode', () => {
    it('返回有效的 nodeId', () => {
      const id = factory.createJsonSourcePreviewNode(
        'src1',
        { x: 0, y: 0 },
        {
          fileId: 'f1',
          fileName: 'data.json',
        }
      )
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('addNodes 被调用，传入节点包含正确的 type', () => {
      factory.createJsonSourcePreviewNode(
        'src1',
        { x: 0, y: 0 },
        {
          fileId: 'f1',
          fileName: 'data.json',
        }
      )
      expect(addNodes).toHaveBeenCalledTimes(1)
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.type).toBe('jsonSourcePreview')
    })

    it('节点 data 包含正确的文件信息', () => {
      factory.createJsonSourcePreviewNode(
        'src1',
        { x: 0, y: 0 },
        {
          fileId: 'f1',
          fileName: 'data.json',
          sourceMode: 'localfile',
          localPath: '/path/to/data.json',
        }
      )
      const node = vi.mocked(addNodes).mock.calls[0][0]
      expect(node.data.configName).toBe('JsonSource_src1')
      expect(node.data.sourceName).toBe('src1')
      expect(node.data.fileName).toBe('data.json')
      expect(node.data.sourceMode).toBe('localfile')
      expect(node.data.localPath).toBe('/path/to/data.json')
      expect(node.data.isPreviewNode).toBe(true)
    })
  })
})

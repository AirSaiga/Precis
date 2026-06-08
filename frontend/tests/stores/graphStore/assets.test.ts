import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData, TableAsset } from '@/types/graph'
import { createAssetsModule } from '@/stores/graphStore/modules/assets'

function makeSchemaNode(id: string, tableName: string, columns: Array<{ columnName: string; dataType: string }> = []): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: `Schema_${tableName}`,
      tableName,
      sheetName: 'Sheet1',
      columns: columns.map((c, i) => ({
        id: `col${i}`,
        columnName: c.columnName,
        dataType: c.dataType,
        validationErrors: [],
      })),
    } as unknown as CustomNodeData,
  } as CustomNode
}

describe('createAssetsModule', () => {
  let nodes: Ref<CustomNode[]>
  let assets: Ref<TableAsset[]>
  let module: ReturnType<typeof createAssetsModule>
  const mockClearCanvas = vi.fn()
  const mockCreateSchemaNode = vi.fn()

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    assets = ref<TableAsset[]>([])
    mockCreateSchemaNode.mockReturnValue('new-schema-id')
    module = createAssetsModule({
      nodes,
      assets,
      clearCanvas: mockClearCanvas,
      createSchemaNode: mockCreateSchemaNode,
    })
    mockClearCanvas.mockClear()
    mockCreateSchemaNode.mockClear()
  })

  describe('saveCanvasAsAsset', () => {
    it('保存 Schema 节点为资产', () => {
      nodes.value = [makeSchemaNode('s1', 'users', [
        { columnName: 'email', dataType: 'string' },
        { columnName: 'age', dataType: 'integer' },
      ])]

      const assetId = module.saveCanvasAsAsset('MyAsset')

      expect(typeof assetId).toBe('string')
      expect(assets.value).toHaveLength(1)
      expect(assets.value[0].configName).toBe('MyAsset')
      expect(assets.value[0].tableName).toBe('users')
      expect(assets.value[0].columns).toHaveLength(2)
    })

    it('无 Schema 节点时抛出错误', () => {
      expect(() => module.saveCanvasAsAsset('test')).toThrow('画布上未找到Schema节点')
    })

    it('空名称时使用节点原有名称', () => {
      nodes.value = [makeSchemaNode('s1', 'users')]
      module.saveCanvasAsAsset('')
      expect(assets.value[0].configName).toBe('Schema_users')
    })
  })

  describe('loadAssetToCanvas', () => {
    it('加载资产到画布', () => {
      assets.value = [{
        id: 'a1',
        configName: 'MyAsset',
        tableName: 'users',
        sheetName: 'Sheet1',
        columns: [{ columnName: 'email', dataType: 'string' }],
      }]
      nodes.value = [makeSchemaNode('new-schema-id', '')]

      module.loadAssetToCanvas('a1')

      expect(mockClearCanvas).toHaveBeenCalled()
      expect(mockCreateSchemaNode).toHaveBeenCalledWith({ x: 100, y: 100 }, 'MyAsset')
    })

    it('不存在的资产不操作', () => {
      module.loadAssetToCanvas('nonexistent')
      expect(mockClearCanvas).not.toHaveBeenCalled()
    })
  })
})

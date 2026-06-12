import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

vi.mock('@/api/projectV2Api', () => ({
  getV2Constraint: vi.fn(),
}))

vi.mock('@/services/constraints/nodeDataBuilder', () => ({
  buildNodeData: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { addNodes } from '@/services/canvas/vueFlowApi'
import { getV2Constraint } from '@/api/projectV2Api'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
import { logger } from '@/core/utils/logger'
import { createV2ConstraintImporter } from '@/stores/graphStore/modules/v2/import/constraint'

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as CustomNodeData } as CustomNode
}

describe('createV2ConstraintImporter', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let selectedNodeId: Ref<string | null>
  let importer: ReturnType<typeof createV2ConstraintImporter>

  const mockEnsureSchema = vi.fn()
  const mockEnsureEdge = vi.fn()
  const mockBufferEdge = vi.fn()

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    selectedNodeId = ref<string | null>(null)

    mockEnsureSchema.mockReset()
    mockEnsureSchema.mockImplementation(async (id: string) => {
      const existing = nodes.value.find((n) => n.id === id)
      if (existing) return existing
      const schemaNode = makeNode(id, 'schema', { tableName: `table_${id}`, columns: [] })
      nodes.value = [...nodes.value, schemaNode]
      return schemaNode
    })

    importer = createV2ConstraintImporter({
      nodes,
      edges,
      selectedNodeId,
      ensureSchemaNode: mockEnsureSchema,
      ensureSchemaToConstraintEdge: mockEnsureEdge,
      bufferEdge: mockBufferEdge,
    })

    vi.mocked(addNodes).mockClear()
    vi.mocked(getV2Constraint).mockClear()
    vi.mocked(buildNodeData).mockClear()
    mockEnsureEdge.mockClear()
    mockBufferEdge.mockClear()
  })

  describe('幂等性', () => {
    it('已存在的节点不重复创建', async () => {
      nodes.value = [makeNode('c1', 'notNullConstraint')]
      const result = await importer.importConstraint('c1', { x: 10, y: 10 })
      expect(result).toBe('c1')
      expect(getV2Constraint).not.toHaveBeenCalled()
    })

    it('moveIfExists=true 时更新位置', async () => {
      const node = makeNode('c1', 'notNullConstraint')
      node.position = { x: 0, y: 0 }
      nodes.value = [node]

      await importer.importConstraint('c1', { x: 99, y: 99 }, { moveIfExists: true })
      expect(node.position).toEqual({ x: 99, y: 99 })
      expect(selectedNodeId.value).toBe('c1')
    })
  })

  describe('NotNull 约束导入', () => {
    it('正确构建 BuildInput 并创建节点', async () => {
      vi.mocked(getV2Constraint).mockResolvedValue({
        type: 'NotNull',
        description: 'email not null',
        refs: { table_id: 's1', column_id: 'col1' },
        params: {},
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { configName: 'email not null', table: 'users', column: 'email', saveState: 'saved' },
        edgeDescriptors: [{ kind: 'constraint', sourceNodeId: 's1', targetNodeId: 'c1', columnId: 'col1' }],
      } as any)

      const result = await importer.importConstraint('c1', { x: 100, y: 200 })

      expect(result).toBe('c1')
      expect(getV2Constraint).toHaveBeenCalledWith('c1')
      expect(buildNodeData).toHaveBeenCalledWith('notNull', expect.objectContaining({
        mode: 'import',
        schemaNodeId: 's1',
        nodeId: 'c1',
        nodeType: 'notNullConstraint',
      }))
      expect(addNodes).toHaveBeenCalledTimes(1)
      expect(mockEnsureEdge).toHaveBeenCalledWith('s1', 'c1', 'col1')
      expect(selectedNodeId.value).toBe('c1')
    })
  })

  describe('ForeignKey 约束导入', () => {
    it('FK 有两个 Schema 引用', async () => {
      vi.mocked(getV2Constraint).mockResolvedValue({
        type: 'ForeignKey',
        description: 'user FK',
        refs: { from_table_id: 's1', from_column_id: 'col1', to_table_id: 's2', to_column_id: 'col2' },
        params: {},
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { configName: 'user FK', saveState: 'saved' },
        edgeDescriptors: [
          { kind: 'constraint', sourceNodeId: 's1', targetNodeId: 'c1', columnId: 'col1' },
          { kind: 'fkDisplay', sourceNodeId: 'c1', targetNodeId: 's2', extra: { label: 'FK' } },
        ],
      } as any)

      await importer.importConstraint('c1', { x: 100, y: 100 })

      expect(mockEnsureSchema).toHaveBeenCalledWith('s1', expect.any(Object))
      expect(mockEnsureSchema).toHaveBeenCalledWith('s2', expect.any(Object))
      expect(buildNodeData).toHaveBeenCalledWith('foreignKey', expect.objectContaining({
        fkRefs: expect.objectContaining({
          source: expect.objectContaining({ nodeId: 's1', columnId: 'col1' }),
          target: expect.objectContaining({ nodeId: 's2', columnId: 'col2' }),
        }),
      }))
      expect(mockBufferEdge).toHaveBeenCalledTimes(1)
    })
  })

  describe('Conditional 约束导入', () => {
    it('解析 IF 条件和 THEN 列', async () => {
      vi.mocked(getV2Constraint).mockResolvedValue({
        type: 'Conditional',
        description: 'conditional rule',
        refs: {
          table_id: 's1',
          then_column_id: 'col2',
          if_logic: 'and',
          if_conditions: [{ if_column_id: 'col1', operator: 'eq', value: 'active' }],
        },
        params: {},
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { configName: 'conditional rule', saveState: 'saved' },
        edgeDescriptors: [],
      } as any)

      await importer.importConstraint('c1', { x: 0, y: 0 })

      expect(buildNodeData).toHaveBeenCalledWith('conditional', expect.objectContaining({
        ifConditions: [expect.objectContaining({ operator: 'eq', columnId: 'col1' })],
        ifLogic: 'and',
        thenRef: expect.objectContaining({ nodeId: 's1', columnId: 'col2' }),
      }))
    })
  })

  describe('Unique 约束导入', () => {
    it('使用 column_ids 数组', async () => {
      vi.mocked(getV2Constraint).mockResolvedValue({
        type: 'Unique',
        description: 'unique email',
        refs: { table_id: 's1', column_ids: ['col1'] },
        params: {},
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { configName: 'unique email', saveState: 'saved' },
        edgeDescriptors: [],
      } as any)

      await importer.importConstraint('c1', { x: 0, y: 0 })

      expect(buildNodeData).toHaveBeenCalledWith('unique', expect.objectContaining({
        columnRef: expect.objectContaining({ nodeId: 's1', columnId: 'col1' }),
      }))
    })
  })

  describe('未知约束类型', () => {
    it('跳过导入并记录警告', async () => {
      vi.mocked(getV2Constraint).mockResolvedValue({
        type: 'UnknownType',
        description: 'unknown',
        refs: { table_id: 's1', column_id: 'col1' },
        params: {},
      } as any)

      const result = await importer.importConstraint('c1', { x: 0, y: 0 })

      expect(result).toBe('')
      expect(addNodes).not.toHaveBeenCalled()
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  describe('includeDeps=false', () => {
    it('不调用 ensureSchemaNode', async () => {
      nodes.value = [makeNode('s1', 'schema', { tableName: 'users', columns: [] })]

      vi.mocked(getV2Constraint).mockResolvedValue({
        type: 'NotNull',
        refs: { table_id: 's1', column_id: 'col1' },
        params: {},
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { saveState: 'saved' },
        edgeDescriptors: [],
      } as any)

      await importer.importConstraint('c1', { x: 0, y: 0 }, { includeDeps: false })

      expect(mockEnsureSchema).not.toHaveBeenCalled()
    })
  })
})

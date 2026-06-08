import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

vi.mock('@/api/projectV2Api', () => ({
  getV2RegexNode: vi.fn(),
}))

vi.mock('@/services/constraints/nodeDataBuilder', () => ({
  buildNodeData: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { addNodes } from '@/services/canvas/vueFlowApi'
import { getV2RegexNode } from '@/api/projectV2Api'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
import { createV2RegexImporter } from '@/stores/graphStore/modules/v2/import/regex'

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as CustomNodeData } as CustomNode
}

describe('createV2RegexImporter', () => {
  let nodes: Ref<CustomNode[]>
  let selectedNodeId: Ref<string | null>
  let importer: ReturnType<typeof createV2RegexImporter>

  const mockEnsureSchema = vi.fn()
  const mockEnsureRegexEdge = vi.fn()

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    selectedNodeId = ref<string | null>(null)

    mockEnsureSchema.mockReset()
    mockEnsureSchema.mockImplementation(async (id: string) => {
      const existing = nodes.value.find((n) => n.id === id)
      if (existing) return existing
      const schemaNode = makeNode(id, 'schema', {
        tableName: 'users',
        columns: [{ id: 'col1', columnName: 'email' }],
      })
      nodes.value = [...nodes.value, schemaNode]
      return schemaNode
    })

    importer = createV2RegexImporter({
      nodes,
      selectedNodeId,
      ensureSchemaNode: mockEnsureSchema,
      ensureSchemaToRegexEdge: mockEnsureRegexEdge,
    })

    vi.mocked(addNodes).mockClear()
    vi.mocked(getV2RegexNode).mockClear()
    vi.mocked(buildNodeData).mockClear()
    mockEnsureRegexEdge.mockClear()
  })

  describe('幂等性', () => {
    it('已存在的节点不重复创建', async () => {
      nodes.value = [makeNode('r1', 'regex')]
      const result = await importer.importRegex('r1', { x: 10, y: 10 })
      expect(result).toBe('r1')
      expect(getV2RegexNode).not.toHaveBeenCalled()
    })

    it('moveIfExists=true 时更新位置', async () => {
      const node = makeNode('r1', 'regex')
      node.position = { x: 0, y: 0 }
      nodes.value = [node]

      await importer.importRegex('r1', { x: 50, y: 50 }, { moveIfExists: true })
      expect(node.position).toEqual({ x: 50, y: 50 })
    })
  })

  describe('正则节点导入', () => {
    it('正确构建 BuildInput 并创建节点', async () => {
      vi.mocked(getV2RegexNode).mockResolvedValue({
        name: 'EmailRegex',
        pattern: '^[\\w]+@[\\w]+\\.[\\w]+$',
        description: 'email validation',
        source_ref: { table_id: 's1', column_id: 'col1' },
        match_mode: 'full',
        enabled: true,
        case_sensitive: false,
        flags: 'gm',
        rules: [],
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { configName: 'EmailRegex', pattern: '^[\\w]+@[\\w]+\\.[\\w]+$', saveState: 'saved' },
        edgeDescriptors: [{ kind: 'constraint', sourceNodeId: 's1', targetNodeId: 'r1', columnId: 'col1' }],
      } as any)

      const result = await importer.importRegex('r1', { x: 100, y: 200 })

      expect(result).toBe('r1')
      expect(getV2RegexNode).toHaveBeenCalledWith('r1')
      expect(buildNodeData).toHaveBeenCalledWith('regex', expect.objectContaining({
        mode: 'import',
        configName: 'EmailRegex',
        schemaNodeId: 's1',
        nodeType: 'regex',
        params: expect.objectContaining({
          pattern: '^[\\w]+@[\\w]+\\.[\\w]+$',
          match_mode: 'full',
        }),
      }))
      expect(addNodes).toHaveBeenCalledTimes(1)
      expect(mockEnsureRegexEdge).toHaveBeenCalledWith('s1', 'r1', 'col1')
      expect(selectedNodeId.value).toBe('r1')
    })

    it('无 source_ref 时不创建边', async () => {
      vi.mocked(getV2RegexNode).mockResolvedValue({
        name: 'SimpleRegex',
        pattern: '\\d+',
        source_ref: null,
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { configName: 'SimpleRegex', saveState: 'saved' },
        edgeDescriptors: [],
      } as any)

      await importer.importRegex('r1', { x: 0, y: 0 })

      expect(mockEnsureSchema).not.toHaveBeenCalled()
      expect(mockEnsureRegexEdge).not.toHaveBeenCalled()
    })

    it('includeDeps=false 时不调用 ensureSchemaNode', async () => {
      nodes.value = [makeNode('s1', 'schema', {
        tableName: 'users',
        columns: [{ id: 'col1', columnName: 'email' }],
      })]

      vi.mocked(getV2RegexNode).mockResolvedValue({
        name: 'TestRegex',
        pattern: '\\w+',
        source_ref: { table_id: 's1', column_id: 'col1' },
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { saveState: 'saved' },
        edgeDescriptors: [{ kind: 'constraint', sourceNodeId: 's1', targetNodeId: 'r1', columnId: 'col1' }],
      } as any)

      await importer.importRegex('r1', { x: 0, y: 0 }, { includeDeps: false })

      expect(mockEnsureSchema).not.toHaveBeenCalled()
    })
  })
})

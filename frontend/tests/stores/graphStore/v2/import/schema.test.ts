import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
}))

vi.mock('@/api/projectV2Api', () => ({
  getV2Schema: vi.fn(),
}))

vi.mock('@/services/builders', () => ({
  fromBackendType: vi.fn((t: string) => t || 'String'),
}))

vi.mock('@/core/utils/pathNormalization', () => ({
  normalizePath: vi.fn((p: string) => p),
}))

vi.mock('@/stores/graphStore/modules/v2/shared/embeddedConstraints', () => ({
  materializeV2EmbeddedConstraints: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { addNodes } from '@/services/canvas/vueFlowApi'
import { getV2Schema } from '@/api/projectV2Api'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'
import { createV2SchemaImporter } from '@/stores/graphStore/modules/v2/import/schema'

function makeSchemaFile(overrides: Record<string, unknown> = {}) {
  return {
    name: 'users',
    columns: [
      { id: 'col1', name: 'email', type: 'String', nullable: false, primary_key: false },
      { id: 'col2', name: 'age', type: 'Integer', nullable: true, primary_key: false },
    ],
    source: { path: 'data/users.xlsx', mode: 'relative_file', sheet: 'Sheet1' },
    constraints: [],
    ...overrides,
  }
}

describe('createV2SchemaImporter', () => {
  let nodes: Ref<CustomNode[]>
  let importer: ReturnType<typeof createV2SchemaImporter>
  const mockGetConfigPath = vi.fn(() => '/project')
  const mockResolveRelPath = vi.fn((dir?: string, rel?: string) => (dir && rel ? `${dir}/${rel}` : rel))
  const mockEnsureEdge = vi.fn()

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    importer = createV2SchemaImporter({
      nodes,
      getEffectiveProjectConfigPath: mockGetConfigPath,
      resolveProjectRelativePath: mockResolveRelPath,
      ensureSchemaToConstraintEdge: mockEnsureEdge,
    })
    vi.mocked(addNodes).mockClear()
    vi.mocked(getV2Schema).mockClear()
    vi.mocked(materializeV2EmbeddedConstraints).mockClear()
  })

  describe('ensureSchemaNode', () => {
    it('返回已存在的节点（幂等）', async () => {
      const existing = { id: 's1', type: 'schema', position: { x: 0, y: 0 }, data: {} } as CustomNode
      nodes.value = [existing]

      const result = await importer.ensureSchemaNode('s1', { x: 10, y: 10 })
      expect(result.id).toBe('s1')
      expect(result.type).toBe('schema')
      expect(getV2Schema).not.toHaveBeenCalled()
    })

    it('调用 API 加载 schema 并创建节点', async () => {
      vi.mocked(getV2Schema).mockResolvedValue(makeSchemaFile() as any)

      const result = await importer.ensureSchemaNode('s1', { x: 100, y: 200 })

      expect(getV2Schema).toHaveBeenCalledWith('s1')
      expect(addNodes).toHaveBeenCalledTimes(1)
      const node = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect(node.id).toBe('s1')
      expect(node.type).toBe('schema')
      expect(node.position).toEqual({ x: 100, y: 200 })
      expect((node.data as any).tableName).toBe('users')
      expect((node.data as any).sheetName).toBe('Sheet1')
      expect((node.data as any).columns).toHaveLength(2)
      expect((node.data as any).saveState).toBe('saved')
    })

    it('使用传入的 schemaFile 而不调用 API', async () => {
      const schemaFile = makeSchemaFile()
      const result = await importer.ensureSchemaNode('s1', { x: 0, y: 0 }, schemaFile as any)

      expect(getV2Schema).not.toHaveBeenCalled()
      expect(addNodes).toHaveBeenCalledTimes(1)
    })

    it('JSON schema 文件创建 jsonSchema 类型节点', async () => {
      vi.mocked(getV2Schema).mockResolvedValue(
        makeSchemaFile({ source: { path: 'data/config.json', mode: 'relative_file' } }) as any
      )

      await importer.ensureSchemaNode('s1', { x: 0, y: 0 })
      const node = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect(node.type).toBe('jsonSchema')
      expect((node.data as any).sourceType).toBe('json')
    })

    it('absolute_file 模式直接使用路径', async () => {
      vi.mocked(getV2Schema).mockResolvedValue(
        makeSchemaFile({ source: { path: '/abs/data.xlsx', mode: 'absolute_file' } }) as any
      )

      await importer.ensureSchemaNode('s1', { x: 0, y: 0 })
      const node = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect((node.data as any).localPath).toBe('/abs/data.xlsx')
    })
  })

  describe('materializeEmbeddedConstraints', () => {
    it('调用 materializeV2EmbeddedConstraints', () => {
      const schemaNode = {
        id: 's1',
        type: 'schema',
        data: { tableName: 'users', columns: [{ id: 'col1', columnName: 'email' }] },
      } as CustomNode
      const schemaFile = makeSchemaFile({ constraints: [{ type: 'NotNull', column: 'email' }] })

      importer.materializeEmbeddedConstraints(schemaNode, schemaFile as any)

      expect(materializeV2EmbeddedConstraints).toHaveBeenCalledTimes(1)
      const args = vi.mocked(materializeV2EmbeddedConstraints).mock.calls[0][0]
      expect(args.schemaNode).toBe(schemaNode)
      expect(args.schemaTableName).toBe('users')
      expect(args.embeddedConstraints).toHaveLength(1)
    })
  })

  describe('importSchema', () => {
    it('完整流程：API → 节点创建 → 约束物化', async () => {
      vi.mocked(getV2Schema).mockResolvedValue(makeSchemaFile() as any)

      const nodeId = await importer.importSchema('s1', { x: 50, y: 50 })

      expect(nodeId).toBe('s1')
      expect(getV2Schema).toHaveBeenCalledWith('s1')
      expect(addNodes).toHaveBeenCalledTimes(1)
      expect(materializeV2EmbeddedConstraints).toHaveBeenCalledTimes(1)
    })
  })
})

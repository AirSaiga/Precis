import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
  addEdges: vi.fn(),
}))

vi.mock('@/api/projectV2Api', () => ({
  getV2Schema: vi.fn(),
  getV2Constraint: vi.fn(),
  getV2RegexNode: vi.fn(),
  getV2FullConfig: vi.fn(),
}))

vi.mock('@/services/constraints/nodeDataBuilder', () => ({
  buildNodeData: vi.fn(),
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

vi.mock('@/core/toast', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

import { addNodes } from '@/services/canvas/vueFlowApi'
import { getV2Schema, getV2Constraint, getV2RegexNode, getV2FullConfig } from '@/api/projectV2Api'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
import { createV2ImportToCanvas } from '@/stores/graphStore/modules/v2/import/importV2ResourceToCanvas'

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as CustomNodeData } as CustomNode
}

describe('createV2ImportToCanvas', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let selectedNodeId: Ref<string | null>
  let reconcileCalls: number
  let importer: ReturnType<typeof createV2ImportToCanvas>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    selectedNodeId = ref<string | null>(null)
    reconcileCalls = 0

    importer = createV2ImportToCanvas({
      nodes,
      edges,
      selectedNodeId,
      getEffectiveProjectConfigPath: () => '/project',
      resolveProjectRelativePath: (dir, rel) => (dir && rel ? `${dir}/${rel}` : rel),
      reconcileAll: () => {
        reconcileCalls++
      },
    })

    vi.mocked(addNodes).mockClear()
    vi.mocked(getV2Schema).mockClear()
    vi.mocked(getV2Constraint).mockClear()
    vi.mocked(getV2RegexNode).mockClear()
    vi.mocked(getV2FullConfig).mockClear()
    vi.mocked(buildNodeData).mockClear()
  })

  describe('importV2ResourceToCanvas', () => {
    it('schema 类型调用 importSchema 流程', async () => {
      vi.mocked(getV2Schema).mockResolvedValue({
        name: 'users',
        columns: [{ id: 'col1', name: 'email', type: 'String' }],
        source: { path: 'data.xlsx', mode: 'relative_file', sheet: 'Sheet1' },
      } as any)

      const result = await importer.importV2ResourceToCanvas('schema', 's1', { x: 10, y: 10 })

      expect(result).toBe('s1')
      expect(getV2Schema).toHaveBeenCalledWith('s1')
      expect(reconcileCalls).toBeGreaterThanOrEqual(1)
    })

    it('constraint 类型调用 importConstraint 流程', async () => {
      vi.mocked(getV2Constraint).mockResolvedValue({
        type: 'NotNull',
        refs: { table_id: 's1', column_id: 'col1' },
        params: {},
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { saveState: 'saved' },
        edgeDescriptors: [],
      } as any)

      const result = await importer.importV2ResourceToCanvas('constraint', 'c1', { x: 10, y: 10 })

      expect(result).toBe('c1')
      expect(getV2Constraint).toHaveBeenCalledWith('c1')
    })

    it('regex 类型调用 importRegex 流程', async () => {
      vi.mocked(getV2RegexNode).mockResolvedValue({
        name: 'test',
        pattern: '\\d+',
        source_ref: null,
      } as any)

      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { saveState: 'saved' },
        edgeDescriptors: [],
      } as any)

      const result = await importer.importV2ResourceToCanvas('regex', 'r1', { x: 0, y: 0 })

      expect(result).toBe('r1')
      expect(getV2RegexNode).toHaveBeenCalledWith('r1')
    })

    it('pattern/regex_node 归一化为 regex', async () => {
      nodes.value = [makeNode('r1', 'regex')]

      const result = await importer.importV2ResourceToCanvas('pattern', 'r1', { x: 0, y: 0 })

      expect(result).toBe('r1')
    })

    it('已存在的非 schema 节点幂等返回', async () => {
      nodes.value = [makeNode('c1', 'notNullConstraint')]

      const result = await importer.importV2ResourceToCanvas('constraint', 'c1', { x: 50, y: 50 })

      expect(result).toBe('c1')
      expect(getV2Constraint).not.toHaveBeenCalled()
      expect(reconcileCalls).toBeGreaterThanOrEqual(1)
    })

    it('已存在节点 + moveIfExists 更新位置', async () => {
      const node = makeNode('c1', 'notNullConstraint')
      node.position = { x: 0, y: 0 }
      nodes.value = [node]

      await importer.importV2ResourceToCanvas(
        'constraint',
        'c1',
        { x: 99, y: 99 },
        { moveIfExists: true }
      )

      expect(node.position).toEqual({ x: 99, y: 99 })
      expect(selectedNodeId.value).toBe('c1')
    })

    it('transform 类型从 fullConfig 加载', async () => {
      vi.mocked(getV2FullConfig).mockResolvedValue({
        transforms: {
          t1: { name: 'MyTransform', type: 'StringSplit', description: 'test' },
        },
      } as any)

      const result = await importer.importV2ResourceToCanvas('transform', 't1', { x: 0, y: 0 })

      expect(result).toBe('t1')
      expect(getV2FullConfig).toHaveBeenCalled()
      expect(addNodes).toHaveBeenCalledTimes(1)
    })

    it('API 失败时返回 null 并 toast', async () => {
      vi.mocked(getV2Schema).mockRejectedValue(new Error('Network error'))

      const result = await importer.importV2ResourceToCanvas('schema', 's1', { x: 0, y: 0 })

      expect(result).toBeNull()
    })

    it('未知类型返回 null', async () => {
      const result = await importer.importV2ResourceToCanvas('unknown' as any, 'x1', { x: 0, y: 0 })
      expect(result).toBeNull()
    })
  })
})

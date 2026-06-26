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

// useGlobalConfirm 是外部 UI 边界（弹窗），单测中直接 mock。
// showConfirm 用模块级 mock fn，便于单个测试动态覆盖返回值
// （true=全部导入 / false=只导 Schema）。避免触发 @/i18n 的 createI18n 实例化链。
const showConfirmMock = vi.fn().mockResolvedValue(false)
vi.mock('@/composables/useGlobalConfirm', () => ({
  useGlobalConfirm: () => ({
    showConfirm: showConfirmMock,
    visible: { value: false },
    options: { value: {} },
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    handleAlternative: vi.fn(),
  }),
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
    showConfirmMock.mockClear()
    showConfirmMock.mockResolvedValue(false)
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

  describe('importV2ResourceToCanvas schema 关联独立约束弹窗', () => {
    // 本 describe 专项测试「拖拽 Schema 时弹窗询问是否连带独立约束」的编排逻辑。
    // 需要注入 getIndependentConstraintIdsForSchema（外层 beforeEach 的 importer 未注入），
    // 故在此独立构建 importer。
    let promptImporter: ReturnType<typeof createV2ImportToCanvas>

    beforeEach(() => {
      vi.mocked(getV2Schema).mockResolvedValue({
        name: 'users',
        columns: [{ id: 'col1', name: 'email', type: 'String' }],
        source: { path: 'data.xlsx', mode: 'relative_file', sheet: 'Sheet1' },
      } as any)
      // importConstraint 依赖：getV2Constraint + buildNodeData
      vi.mocked(getV2Constraint).mockResolvedValue({
        type: 'NotNull',
        refs: { table_id: 's1', column_id: 'col1' },
        params: {},
      } as any)
      vi.mocked(buildNodeData).mockReturnValue({
        nodeData: { saveState: 'saved' },
        edgeDescriptors: [],
      } as any)
    })

    function makePromptImporter(
      getIndependentConstraintIdsForSchema: ((schemaId: string) => string[] | undefined) | undefined
    ) {
      return createV2ImportToCanvas({
        nodes,
        edges,
        selectedNodeId,
        getEffectiveProjectConfigPath: () => '/project',
        resolveProjectRelativePath: (dir, rel) => (dir && rel ? `${dir}/${rel}` : rel),
        reconcileAll: () => {},
        getIndependentConstraintIdsForSchema,
      })
    }

    it('选“全部导入”时连带创建关联独立约束节点', async () => {
      promptImporter = makePromptImporter(() => ['c_related_1', 'c_related_2'])
      showConfirmMock.mockResolvedValue(true) // 用户选「全部导入」

      await promptImporter.importV2ResourceToCanvas('schema', 's1', { x: 0, y: 0 })

      // 弹窗被调用
      expect(showConfirmMock).toHaveBeenCalledTimes(1)
      // 两个关联约束都被导入（getV2Constraint 被调用两次）
      expect(getV2Constraint).toHaveBeenCalledWith('c_related_1')
      expect(getV2Constraint).toHaveBeenCalledWith('c_related_2')
      // 画布上出现 Schema + 2 个约束节点
      expect(nodes.value.some((n) => n.id === 's1')).toBe(true)
      expect(nodes.value.some((n) => n.id === 'c_related_1')).toBe(true)
      expect(nodes.value.some((n) => n.id === 'c_related_2')).toBe(true)
    })

    it('选“只导 Schema”时不连带创建独立约束', async () => {
      promptImporter = makePromptImporter(() => ['c_related_1'])
      showConfirmMock.mockResolvedValue(false) // 用户选「只导 Schema」/取消

      await promptImporter.importV2ResourceToCanvas('schema', 's1', { x: 0, y: 0 })

      expect(showConfirmMock).toHaveBeenCalledTimes(1)
      // 独立约束未被导入
      expect(getV2Constraint).not.toHaveBeenCalled()
      expect(nodes.value.some((n) => n.id === 'c_related_1')).toBe(false)
      // Schema 仍被创建
      expect(nodes.value.some((n) => n.id === 's1')).toBe(true)
    })

    it('关联约束已全部在画布上时智能跳过弹窗', async () => {
      // 预置：关联约束已在画布上
      nodes.value = [makeNode('c_already', 'notNullConstraint')]
      promptImporter = makePromptImporter(() => ['c_already'])

      await promptImporter.importV2ResourceToCanvas('schema', 's1', { x: 0, y: 0 })

      // 无待导入约束 → 不弹窗
      expect(showConfirmMock).not.toHaveBeenCalled()
      expect(getV2Constraint).not.toHaveBeenCalled()
    })

    it('无关联独立约束时不弹窗（零打扰）', async () => {
      promptImporter = makePromptImporter(() => undefined)

      await promptImporter.importV2ResourceToCanvas('schema', 's1', { x: 0, y: 0 })

      expect(showConfirmMock).not.toHaveBeenCalled()
    })
  })
})

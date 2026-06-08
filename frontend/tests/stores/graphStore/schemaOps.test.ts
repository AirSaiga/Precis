import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addEdges: vi.fn(),
  removeEdges: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { addEdges, removeEdges } from '@/services/canvas/vueFlowApi'
import { createSchemaOpsModule } from '@/stores/graphStore/modules/schemaOps'

function makeSchemaNode(id: string, columns: Array<{ id: string; columnName: string; constraints?: Record<string, boolean>; validationErrors?: unknown[] }> = []): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: 'test',
      tableName: 'users',
      columns: columns.map((c) => ({
        id: c.id,
        columnName: c.columnName,
        dataType: 'string',
        constraints: c.constraints,
        validationErrors: c.validationErrors || [],
      })),
    } as unknown as CustomNodeData,
  } as CustomNode
}

function makeRegexNode(id: string): CustomNode {
  return {
    id,
    type: 'regex',
    position: { x: 0, y: 0 },
    data: { configName: 'test-regex', pattern: '\\d+' } as unknown as CustomNodeData,
  } as CustomNode
}

describe('createSchemaOpsModule', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let module: ReturnType<typeof createSchemaOpsModule>
  const mockUpdateNodeData = vi.fn()
  const mockSyncOnConnect = vi.fn()

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    module = createSchemaOpsModule({
      nodes,
      edges,
      updateNodeData: mockUpdateNodeData,
      syncOnConnect: mockSyncOnConnect,
    })
    vi.mocked(addEdges).mockClear()
    vi.mocked(removeEdges).mockClear()
    mockUpdateNodeData.mockClear()
    mockSyncOnConnect.mockClear()
  })

  describe('bindRegexToSchemaColumn', () => {
    it('创建 schema→regex 连接', () => {
      nodes.value = [
        makeSchemaNode('s1', [{ id: 'col1', columnName: 'email' }]),
        makeRegexNode('r1'),
      ]

      const result = module.bindRegexToSchemaColumn('s1', 'col1', 'r1')

      expect(result).toBe(true)
      expect(addEdges).toHaveBeenCalled()
      expect(mockUpdateNodeData).toHaveBeenCalledWith('r1', expect.objectContaining({
        sourceRef: { nodeId: 's1', columnId: 'col1' },
        sourceNodeId: 's1',
        sourceColumnName: 'email',
      }))
      expect(mockSyncOnConnect).toHaveBeenCalledWith('s1', 'r1')
    })

    it('先删除旧入边再创建新边', () => {
      nodes.value = [
        makeSchemaNode('s1', [{ id: 'col1', columnName: 'email' }]),
        makeRegexNode('r1'),
      ]
      edges.value = [{ id: 'old-edge', source: 's2', target: 'r1', targetHandle: 'regex-input' } as Edge]

      module.bindRegexToSchemaColumn('s1', 'col1', 'r1')

      expect(removeEdges).toHaveBeenCalledWith('old-edge')
    })

    it('节点不存在时返回 false', () => {
      nodes.value = []
      const result = module.bindRegexToSchemaColumn('s1', 'col1', 'r1')
      expect(result).toBe(false)
    })
  })

  describe('addConstraintToColumn', () => {
    it('添加 notNull 约束标记', () => {
      nodes.value = [makeSchemaNode('s1', [{ id: 'col1', columnName: 'email' }])]

      module.addConstraintToColumn('s1', 'col1', 'notNull')

      expect(mockUpdateNodeData).toHaveBeenCalledWith('s1', expect.objectContaining({
        columns: [expect.objectContaining({
          constraints: { notNull: true },
        })],
      }))
    })
  })

  describe('removeConstraintFromColumn', () => {
    it('移除约束标记', () => {
      nodes.value = [makeSchemaNode('s1', [{ id: 'col1', columnName: 'email', constraints: { notNull: true, unique: true } }])]

      module.removeConstraintFromColumn('s1', 'col1', 'notNull')

      expect(mockUpdateNodeData).toHaveBeenCalledWith('s1', expect.objectContaining({
        columns: [expect.objectContaining({
          constraints: { unique: true },
        })],
      }))
    })
  })

  describe('hasColumnConstraint', () => {
    it('有约束时返回 true', () => {
      nodes.value = [makeSchemaNode('s1', [{ id: 'col1', columnName: 'email', constraints: { notNull: true } }])]
      expect(module.hasColumnConstraint('s1', 'col1', 'notNull')).toBe(true)
    })

    it('无约束时返回 false', () => {
      nodes.value = [makeSchemaNode('s1', [{ id: 'col1', columnName: 'email' }])]
      expect(module.hasColumnConstraint('s1', 'col1', 'notNull')).toBe(false)
    })

    it('节点不存在时返回 false', () => {
      expect(module.hasColumnConstraint('nonexistent', 'col1', 'notNull')).toBe(false)
    })
  })

  describe('clearColumnValidationErrors', () => {
    it('清除指定列的验证错误', () => {
      nodes.value = [makeSchemaNode('s1', [{ id: 'col1', columnName: 'email', validationErrors: ['err1'] }])]

      module.clearColumnValidationErrors('s1', 'col1')

      expect(mockUpdateNodeData).toHaveBeenCalledWith('s1', expect.objectContaining({
        columns: [expect.objectContaining({ validationErrors: [] })],
      }))
    })
  })

  describe('clearAllValidationErrors', () => {
    it('清除所有列的验证错误', () => {
      nodes.value = [makeSchemaNode('s1', [
        { id: 'col1', columnName: 'email', validationErrors: ['err1'] },
        { id: 'col2', columnName: 'age', validationErrors: ['err2'] },
      ])]

      module.clearAllValidationErrors('s1')

      expect(mockUpdateNodeData).toHaveBeenCalledWith('s1', expect.objectContaining({
        columns: [
          expect.objectContaining({ validationErrors: [] }),
          expect.objectContaining({ validationErrors: [] }),
        ],
      }))
    })
  })
})

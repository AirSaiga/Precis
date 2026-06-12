import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addEdges: vi.fn(),
  removeEdges: vi.fn(),
}))

vi.mock('@/services/disconnect', () => ({
  executeDisconnectCleanup: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { addEdges, removeEdges } from '@/services/canvas/vueFlowApi'
import { executeDisconnectCleanup } from '@/services/disconnect'
import { createConnectionOpsModule } from '@/stores/graphStore/modules/connectionOps'

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as CustomNodeData } as CustomNode
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge
}

describe('createConnectionOpsModule', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let module: ReturnType<typeof createConnectionOpsModule>
  const mockUpdateNodeData = vi.fn()
  const mockClearValidation = vi.fn()
  const mockSyncOnDisconnect = vi.fn()

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    module = createConnectionOpsModule({
      nodes,
      edges,
      updateNodeData: mockUpdateNodeData,
      clearAllValidationErrors: mockClearValidation,
      syncOnDisconnect: mockSyncOnDisconnect,
    })
    vi.mocked(addEdges).mockClear()
    vi.mocked(removeEdges).mockClear()
    vi.mocked(executeDisconnectCleanup).mockClear()
    mockSyncOnDisconnect.mockClear()
  })

  describe('createConnection', () => {
    it('创建连接并调用 addEdges', () => {
      const edgeId = module.createConnection('s1', 'c1', 'source-right-col1', 'target-input-c1')

      expect(typeof edgeId).toBe('string')
      expect(addEdges).toHaveBeenCalledTimes(1)
      const edge = vi.mocked(addEdges).mock.calls[0][0] as Edge
      expect(edge.source).toBe('s1')
      expect(edge.target).toBe('c1')
      expect(edge.sourceHandle).toBe('source-right-col1')
      expect(edge.targetHandle).toBe('target-input-c1')
    })

    it('支持额外选项', () => {
      module.createConnection('s1', 'c1', undefined, undefined, {
        type: 'smoothstep',
        animated: true,
      })

      const edge = vi.mocked(addEdges).mock.calls[0][0] as Edge
      expect(edge.type).toBe('smoothstep')
      expect(edge.animated).toBe(true)
    })
  })

  describe('deleteConnection', () => {
    it('调用 removeEdges', () => {
      module.deleteConnection('e1')
      expect(removeEdges).toHaveBeenCalledWith('e1')
    })
  })

  describe('handleEdgeRemoved', () => {
    it('调用 syncOnDisconnect 和 executeDisconnectCleanup', () => {
      nodes.value = [makeNode('s1', 'schema'), makeNode('c1', 'notNullConstraint')]
      const edge = makeEdge('e1', 's1', 'c1')

      module.handleEdgeRemoved(edge)

      expect(mockSyncOnDisconnect).toHaveBeenCalledWith(edge)
      expect(executeDisconnectCleanup).toHaveBeenCalledWith(
        edge,
        expect.objectContaining({ id: 's1' }),
        expect.objectContaining({ id: 'c1' }),
        expect.objectContaining({ nodes, edges })
      )
    })

    it('跳过瞬态边', () => {
      const edge = {
        id: 'e1',
        source: 's1',
        target: 'c1',
        data: { transient: true },
      } as unknown as Edge

      module.handleEdgeRemoved(edge)

      expect(mockSyncOnDisconnect).not.toHaveBeenCalled()
      expect(executeDisconnectCleanup).not.toHaveBeenCalled()
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'

const addEdgesCalls: Edge[][] = []

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addEdges: vi.fn((edges: Edge | Edge[]) => {
    addEdgesCalls.push(Array.isArray(edges) ? [...edges] : [edges])
  }),
}))

import { addEdges } from '@/services/canvas/vueFlowApi'
import { createV2ImportEdges } from '@/stores/graphStore/modules/v2/import/edges'

describe('createV2ImportEdges', () => {
  let edges: Ref<Edge[]>
  let module: ReturnType<typeof createV2ImportEdges>

  beforeEach(() => {
    edges = ref<Edge[]>([])
    module = createV2ImportEdges({ edges })
    vi.mocked(addEdges).mockClear()
    addEdgesCalls.length = 0
  })

  describe('ensureSchemaToRegexEdge', () => {
    it('创建 schema→regex 边并缓冲', () => {
      module.ensureSchemaToRegexEdge('s1', 'r1', 'col1')
      module.flushBufferedEdges()

      expect(addEdges).toHaveBeenCalledTimes(1)
      expect(addEdgesCalls).toHaveLength(1)
      expect(addEdgesCalls[0]).toHaveLength(1)
      expect(addEdgesCalls[0][0].id).toBe('e-s1-r1-col1')
      expect(addEdgesCalls[0][0].source).toBe('s1')
      expect(addEdgesCalls[0][0].target).toBe('r1')
      expect(addEdgesCalls[0][0].sourceHandle).toBe('source-right-col1')
      expect(addEdgesCalls[0][0].targetHandle).toBe('regex-input')
      expect(addEdgesCalls[0][0].animated).toBe(true)
    })

    it('已存在的边不重复缓冲（edges 数组）', () => {
      edges.value = [{ id: 'e-s1-r1-col1' } as Edge]
      module.ensureSchemaToRegexEdge('s1', 'r1', 'col1')
      module.flushBufferedEdges()

      expect(addEdges).not.toHaveBeenCalled()
    })

    it('已存在的边不重复缓冲（buffer）', () => {
      module.ensureSchemaToRegexEdge('s1', 'r1', 'col1')
      module.ensureSchemaToRegexEdge('s1', 'r1', 'col1')
      module.flushBufferedEdges()

      expect(addEdges).toHaveBeenCalledTimes(1)
      expect(addEdgesCalls[0]).toHaveLength(1)
    })
  })

  describe('ensureSchemaToConstraintEdge', () => {
    it('创建 schema→constraint 边并缓冲', () => {
      module.ensureSchemaToConstraintEdge('s1', 'c1', 'col1')
      module.flushBufferedEdges()

      expect(addEdges).toHaveBeenCalledTimes(1)
      expect(addEdgesCalls[0]).toHaveLength(1)
      expect(addEdgesCalls[0][0].id).toBe('e-s1-c1-col1')
      expect(addEdgesCalls[0][0].sourceHandle).toBe('source-right-col1')
      expect(addEdgesCalls[0][0].targetHandle).toBe('target-input-c1')
      expect(addEdgesCalls[0][0].type).toBe('smoothstep')
    })

    it('已存在的边不重复创建', () => {
      edges.value = [{ id: 'e-s1-c1-col1' } as Edge]
      module.ensureSchemaToConstraintEdge('s1', 'c1', 'col1')
      module.flushBufferedEdges()

      expect(addEdges).not.toHaveBeenCalled()
    })
  })

  describe('bufferEdge', () => {
    it('缓冲通用边', () => {
      const edge = { id: 'custom-e1', source: 'a', target: 'b' } as Edge
      module.bufferEdge(edge)
      module.flushBufferedEdges()

      expect(addEdges).toHaveBeenCalledTimes(1)
      expect(addEdgesCalls[0]).toHaveLength(1)
      expect(addEdgesCalls[0][0].id).toBe('custom-e1')
    })

    it('已存在于 edges 中的边不缓冲', () => {
      edges.value = [{ id: 'dup-e1' } as Edge]
      module.bufferEdge({ id: 'dup-e1' } as Edge)
      module.flushBufferedEdges()

      expect(addEdges).not.toHaveBeenCalled()
    })
  })

  describe('flushBufferedEdges', () => {
    it('空缓冲时不调用 addEdges', () => {
      module.flushBufferedEdges()
      expect(addEdges).not.toHaveBeenCalled()
    })

    it('刷新后清空缓冲', () => {
      module.ensureSchemaToRegexEdge('s1', 'r1', 'col1')
      module.flushBufferedEdges()
      vi.mocked(addEdges).mockClear()
      addEdgesCalls.length = 0

      module.flushBufferedEdges()
      expect(addEdges).not.toHaveBeenCalled()
    })

    it('批量提交多条边', () => {
      module.ensureSchemaToRegexEdge('s1', 'r1', 'col1')
      module.ensureSchemaToConstraintEdge('s1', 'c1', 'col2')
      module.flushBufferedEdges()

      expect(addEdges).toHaveBeenCalledTimes(1)
      expect(addEdgesCalls[0]).toHaveLength(2)
    })
  })
})

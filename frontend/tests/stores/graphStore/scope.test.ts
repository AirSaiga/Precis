import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/constraints/validationRegistry', () => ({
  isConstraintNodeType: vi.fn((type: string) => type.includes('Constraint')),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { createScopeModule } from '@/stores/graphStore/modules/scope'

function makeNode(id: string, type: string): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: {} as CustomNodeData } as CustomNode
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge
}

describe('createScopeModule', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let module: ReturnType<typeof createScopeModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    module = createScopeModule({ nodes, edges })
  })

  describe('getSubGraphStats', () => {
    it('统计直接子节点', () => {
      nodes.value = [
        makeNode('s1', 'schema'),
        makeNode('c1', 'notNullConstraint'),
        makeNode('c2', 'uniqueConstraint'),
        makeNode('r1', 'regex'),
      ]
      edges.value = [
        makeEdge('e1', 's1', 'c1'),
        makeEdge('e2', 's1', 'c2'),
        makeEdge('e3', 's1', 'r1'),
      ]

      const stats = module.getSubGraphStats('s1')

      expect(stats.totalNodes).toBe(3)
      expect(stats.schemaNodes).toBe(0)
      expect(stats.constraintNodes).toBe(2)
      expect(stats.regexNodes).toBe(1)
      expect(stats.ruleCount).toBe(2)
      expect(stats.tableCount).toBe(0)
    })

    it('无子节点时返回全零', () => {
      nodes.value = [makeNode('s1', 'schema')]
      const stats = module.getSubGraphStats('s1')
      expect(stats.totalNodes).toBe(0)
    })

    it('只统计直接子节点', () => {
      nodes.value = [
        makeNode('s1', 'schema'),
        makeNode('c1', 'notNullConstraint'),
        makeNode('c2', 'uniqueConstraint'),
      ]
      edges.value = [makeEdge('e1', 's1', 'c1'), makeEdge('e2', 'c1', 'c2')]

      const stats = module.getSubGraphStats('s1')
      expect(stats.totalNodes).toBe(1)
    })
  })
})

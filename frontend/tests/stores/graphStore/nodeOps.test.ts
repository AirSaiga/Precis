/**
 * @fileoverview nodeOps 模块单元测试
 *
 * 测试 deleteNode / deleteNodes / moveSelectedNode / moveSelectedNodes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { createNodeOpsModule, type NodeOpsDeps } from '@/stores/graphStore/modules/nodeOps'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  removeNodes: vi.fn(),
  removeEdges: vi.fn(),
  updateNode: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// 动态引用 mock,以便单个测试可覆盖其实现
let updateNodeMock: ReturnType<typeof vi.fn>
beforeEach(async () => {
  const vu = await import('@/services/canvas/vueFlowApi')
  updateNodeMock = vu.updateNode as ReturnType<typeof vi.fn>
  updateNodeMock.mockReset()
})

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as CustomNodeData } as CustomNode
}

function makeModule(overrides: Partial<NodeOpsDeps> = {}) {
  const nodes = ref<CustomNode[]>([])
  const edges = ref<Edge[]>([])
  const selectedNodeId = ref<string | null>(null)
  const selectedNodeIds = ref<string[]>([])
  const clearExpansion = vi.fn()
  const templateExpand = { getExpandedIds: vi.fn(() => []), ...overrides.templateExpand }
  const reconcileAll = vi.fn(async () => {})

  const module = createNodeOpsModule({
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    reconcileAll,
    templateExpand,
    clearExpansion,
    ...overrides,
  } as NodeOpsDeps)

  return {
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    clearExpansion,
    templateExpand,
    reconcileAll,
    module,
  }
}

describe('nodeOps', () => {
  describe('deleteNode - templateInstance', () => {
    it('删除 templateInstance 时调用 clearExpansion 清理展开状态', async () => {
      const { nodes, templateExpand, clearExpansion, module } = makeModule({
        templateExpand: { getExpandedIds: () => ['child1', 'child2'] },
      })
      nodes.value = [
        makeNode('inst1', 'templateInstance', { expanded: true }),
        makeNode('child1', 'transform', {}),
        makeNode('child2', 'constraint', {}),
      ]

      await module.deleteNode('inst1')

      expect(clearExpansion).toHaveBeenCalledWith('inst1')
    })

    it('删除非 templateInstance 节点时不调用 clearExpansion', async () => {
      const { nodes, clearExpansion, module } = makeModule()
      nodes.value = [makeNode('s1', 'schema', { columns: [] })]

      await module.deleteNode('s1')

      expect(clearExpansion).not.toHaveBeenCalled()
    })
  })

  describe('moveSelectedNode', () => {
    it('Vue Flow API 初始化时通过 updateNode 移动,不直接 mutate node.position', () => {
      const { nodes, selectedNodeId, module } = makeModule()
      nodes.value = [makeNode('n1', 'schema', { configName: 'A' })]
      selectedNodeId.value = 'n1'

      module.moveSelectedNode(10, 0)

      expect(updateNodeMock).toHaveBeenCalledWith('n1', { position: { x: 10, y: 0 } })
    })

    it('Vue Flow API 未初始化时不抛错,不直接 mutate node.position', () => {
      updateNodeMock.mockImplementationOnce(() => {
        throw new Error('not initialized')
      })
      const { nodes, selectedNodeId, module } = makeModule()
      const n1 = makeNode('n1', 'schema', { configName: 'A' })
      const originalX = n1.position.x
      nodes.value = [n1]
      selectedNodeId.value = 'n1'

      expect(() => module.moveSelectedNode(10, 0)).not.toThrow()
      // 关键:不 fallback 到直接 mutate,position 保持原值
      expect(nodes.value[0].position.x).toBe(originalX)
    })

    it('未选中节点时为空操作', () => {
      const { module } = makeModule()
      expect(() => module.moveSelectedNode(10, 0)).not.toThrow()
      expect(updateNodeMock).not.toHaveBeenCalled()
    })
  })
})

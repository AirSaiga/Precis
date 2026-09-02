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

// manifest 实例引用删除 API mock（templateInstance 删除同步链）
const { deleteInstanceRefMock } = vi.hoisted(() => ({ deleteInstanceRefMock: vi.fn() }))
vi.mock('@/api/projectV2Api', () => ({
  deleteV2ManifestTemplateInstanceRef: deleteInstanceRefMock,
}))

// 动态引用 mock,以便单个测试可覆盖其实现
let updateNodeMock: ReturnType<typeof vi.fn>
beforeEach(async () => {
  const vu = await import('@/services/canvas/vueFlowApi')
  updateNodeMock = vu.updateNode as ReturnType<typeof vi.fn>
  updateNodeMock.mockReset()
  deleteInstanceRefMock.mockReset()
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
  describe('删除的撤销历史', () => {
    it('deleteNode 删除前压入一份快照，且挂起/恢复历史包裹清理链', async () => {
      const saveState = vi.fn()
      const suspendHistory = vi.fn()
      const resumeHistory = vi.fn()
      const { nodes, module } = makeModule({ saveState, suspendHistory, resumeHistory })
      nodes.value = [makeNode('s1', 'schema', { columns: [] }), makeNode('c1', 'constraint', {})]

      await module.deleteNode('s1')

      expect(saveState).toHaveBeenCalledTimes(1)
      // 挂起先于恢复，且各一次（级联边清理不重复压栈的保证）
      expect(suspendHistory).toHaveBeenCalledTimes(1)
      expect(resumeHistory).toHaveBeenCalledTimes(1)
    })

    it('deleteNode 目标不存在时不压快照（防二次删除产生空撤销步）', async () => {
      const saveState = vi.fn()
      const { module } = makeModule({ saveState })

      await module.deleteNode('ghost')

      expect(saveState).not.toHaveBeenCalled()
    })

    it('deleteNodes 批量删除（含级联）只压一份快照', async () => {
      const saveState = vi.fn()
      const { nodes, module } = makeModule({
        saveState,
        templateExpand: { getExpandedIds: () => ['c1', 'c2'] },
      })
      nodes.value = [
        makeNode('inst1', 'templateInstance', { expanded: true }),
        makeNode('c1', 'transform', {}),
        makeNode('c2', 'constraint', {}),
      ]

      await module.deleteNodes(['inst1'])

      expect(saveState).toHaveBeenCalledTimes(1)
    })

    it('deleteNodes 全部为 projectRoot 时不压快照', async () => {
      const saveState = vi.fn()
      const { nodes, module } = makeModule({ saveState })
      nodes.value = [makeNode('project-root', 'projectRoot', {})]

      await module.deleteNodes(['project-root'])

      expect(saveState).not.toHaveBeenCalled()
    })
  })

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

    it('删除 templateInstance 时同步删除 manifest 实例引用（防幽灵复活）', async () => {
      const { nodes, module } = makeModule({
        templateExpand: { getExpandedIds: () => [] },
      })
      nodes.value = [makeNode('inst1', 'templateInstance', { expanded: false })]

      await module.deleteNode('inst1')

      expect(deleteInstanceRefMock).toHaveBeenCalledWith('inst1')
    })

    it('manifest 引用删除失败不阻断画布删除（仅告警）', async () => {
      deleteInstanceRefMock.mockRejectedValueOnce(new Error('network down'))
      const { nodes, module } = makeModule({
        templateExpand: { getExpandedIds: () => [] },
      })
      nodes.value = [makeNode('inst1', 'templateInstance', { expanded: false })]

      // API 拒绝被 removeTemplateInstanceRef 吞掉：deleteNode 正常完成并走完画布删除
      await module.deleteNode('inst1')

      const vu = await import('@/services/canvas/vueFlowApi')
      expect(vu.removeNodes).toHaveBeenCalledWith(['inst1'])
      expect(deleteInstanceRefMock).toHaveBeenCalledWith('inst1')
    })
  })

  describe('deleteNodes - templateInstance', () => {
    it('批量删除含 templateInstance 时对每个实例调用 clearExpansion', async () => {
      const { nodes, templateExpand, clearExpansion, module } = makeModule({
        templateExpand: { getExpandedIds: () => ['child1'] },
      })
      nodes.value = [
        makeNode('inst1', 'templateInstance', { expanded: true }),
        makeNode('inst2', 'templateInstance', { expanded: true }),
        makeNode('s1', 'schema', { columns: [] }),
        makeNode('child1', 'transform', {}),
      ]

      await module.deleteNodes(['inst1', 'inst2', 's1'])

      expect(clearExpansion).toHaveBeenCalledWith('inst1')
      expect(clearExpansion).toHaveBeenCalledWith('inst2')
    })

    it('批量删除不含 templateInstance 时不调用 clearExpansion', async () => {
      const { nodes, clearExpansion, module } = makeModule()
      nodes.value = [
        makeNode('s1', 'schema', { columns: [] }),
        makeNode('c1', 'notNullConstraint', {}),
      ]

      await module.deleteNodes(['s1', 'c1'])

      expect(clearExpansion).not.toHaveBeenCalled()
    })

    it('批量删除含 templateInstance 时对每个实例同步删除 manifest 引用', async () => {
      const { nodes, module } = makeModule({
        templateExpand: { getExpandedIds: () => [] },
      })
      nodes.value = [
        makeNode('inst1', 'templateInstance', { expanded: false }),
        makeNode('inst2', 'templateInstance', { expanded: false }),
        makeNode('s1', 'schema', { columns: [] }),
      ]

      await module.deleteNodes(['inst1', 'inst2', 's1'])

      expect(deleteInstanceRefMock).toHaveBeenCalledWith('inst1')
      expect(deleteInstanceRefMock).toHaveBeenCalledWith('inst2')
      expect(deleteInstanceRefMock).toHaveBeenCalledTimes(2)
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

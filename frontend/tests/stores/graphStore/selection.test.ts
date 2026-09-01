import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { createSelectionModule } from '@/stores/graphStore/modules/selection'
import { findNode, VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'

// mock vueFlowApi：selection.selectAllNodes 的 VF 侧同步依赖 findNode
vi.mock('@/services/canvas/vueFlowApi', () => {
  class VueFlowApiNotInitializedError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VueFlowApiNotInitializedError'
    }
  }
  return {
    findNode: vi.fn(() => undefined),
    VueFlowApiNotInitializedError,
  }
})

function makeNode(id: string, type = 'schema'): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: {} as CustomNodeData } as CustomNode
}

describe('createSelectionModule', () => {
  let nodes: Ref<CustomNode[]>
  let selectedNodeId: Ref<string | null>
  let selectedNodeIds: Ref<string[]>
  let module: ReturnType<typeof createSelectionModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([makeNode('n1'), makeNode('n2'), makeNode('n3')])
    selectedNodeId = ref<string | null>(null)
    selectedNodeIds = ref<string[]>([])
    module = createSelectionModule({
      nodes,
      selectedNodeId,
      selectedNodeIds,
    })
  })

  describe('selectAllNodes', () => {
    it('选中所有节点', () => {
      module.selectAllNodes()
      expect(selectedNodeIds.value).toEqual(['n1', 'n2', 'n3'])
      expect(selectedNodeId.value).toBe('n3')
    })

    it('空节点列表不操作', () => {
      nodes.value = []
      module.selectAllNodes()
      expect(selectedNodeIds.value).toEqual([])
      expect(selectedNodeId.value).toBeNull()
    })

    it('同步标记 Vue Flow 内部选中集（双选择模型一致性）', () => {
      // 回归：G1 CI 稳定失败根因——全选仅写 Store 时，VF 侧选中集仍是旧值，
      // 下一次 VF→Store 同步会用旧选中集覆写全选结果
      const vfNodes = new Map(['n1', 'n2', 'n3'].map((id) => [id, { selected: false }]))
      vi.mocked(findNode).mockImplementation(((id: string) => vfNodes.get(id)) as never)

      module.selectAllNodes()

      expect(vfNodes.get('n1')?.selected).toBe(true)
      expect(vfNodes.get('n2')?.selected).toBe(true)
      expect(vfNodes.get('n3')?.selected).toBe(true)
      expect(selectedNodeIds.value).toEqual(['n1', 'n2', 'n3'])
    })

    it('Vue Flow 未初始化时不抛错，Store 全选仍生效', () => {
      vi.mocked(findNode).mockImplementation(() => {
        throw new VueFlowApiNotInitializedError('未初始化')
      })

      expect(() => module.selectAllNodes()).not.toThrow()
      expect(selectedNodeIds.value).toEqual(['n1', 'n2', 'n3'])
      expect(selectedNodeId.value).toBe('n3')
    })
  })

  describe('clearSelection', () => {
    it('清空所有选中状态', () => {
      selectedNodeId.value = 'n1'
      selectedNodeIds.value = ['n1', 'n2']
      module.clearSelection()
      expect(selectedNodeIds.value).toEqual([])
      expect(selectedNodeId.value).toBeNull()
    })
  })

  describe('setSelection', () => {
    it('设置多选列表', () => {
      module.setSelection(['n1', 'n2'])
      expect(selectedNodeIds.value).toEqual(['n1', 'n2'])
    })

    it('单选时同步更新 selectedNodeId', () => {
      module.setSelection(['n1'])
      expect(selectedNodeId.value).toBe('n1')
    })

    it('空列表时清空 selectedNodeId', () => {
      selectedNodeId.value = 'n1'
      module.setSelection([])
      expect(selectedNodeId.value).toBeNull()
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { createSelectionModule } from '@/stores/graphStore/modules/selection'

function makeNode(id: string, type = 'schema'): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: {} as CustomNodeData } as CustomNode
}

describe('createSelectionModule', () => {
  let nodes: Ref<CustomNode[]>
  let selectedNodeId: Ref<string | null>
  let selectedNodeIds: Ref<string[]>
  let selectionBox: Ref<{ x: number; y: number; width: number; height: number } | null>
  let isSelecting: Ref<boolean>
  let module: ReturnType<typeof createSelectionModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([makeNode('n1'), makeNode('n2'), makeNode('n3')])
    selectedNodeId = ref<string | null>(null)
    selectedNodeIds = ref<string[]>([])
    selectionBox = ref(null)
    isSelecting = ref(false)
    module = createSelectionModule({
      nodes,
      selectedNodeId,
      selectedNodeIds,
      selectionBox,
      isSelecting,
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
  })

  describe('addToSelection', () => {
    it('添加节点到多选列表', () => {
      module.addToSelection('n1')
      expect(selectedNodeIds.value).toEqual(['n1'])
    })

    it('去重', () => {
      module.addToSelection('n1')
      module.addToSelection('n1')
      expect(selectedNodeIds.value).toEqual(['n1'])
    })
  })

  describe('removeFromSelection', () => {
    it('从多选列表移除', () => {
      selectedNodeIds.value = ['n1', 'n2']
      module.removeFromSelection('n1')
      expect(selectedNodeIds.value).toEqual(['n2'])
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

  describe('setSelectionFromBox', () => {
    it('选中框选区域内的节点', () => {
      nodes.value = [
        { ...makeNode('n1'), position: { x: 100, y: 100 } },
        { ...makeNode('n2'), position: { x: 500, y: 500 } },
        { ...makeNode('n3'), position: { x: 150, y: 150 } },
      ]

      module.setSelectionFromBox({ x: 0, y: 0, width: 300, height: 300 })

      expect(selectedNodeIds.value).toContain('n1')
      expect(selectedNodeIds.value).toContain('n3')
      expect(selectedNodeIds.value).not.toContain('n2')
    })

    it('负宽高正常工作', () => {
      nodes.value = [{ ...makeNode('n1'), position: { x: 100, y: 100 } }]

      module.setSelectionFromBox({ x: 300, y: 300, width: -300, height: -300 })

      expect(selectedNodeIds.value).toContain('n1')
    })
  })

  describe('setSelectionBox', () => {
    it('设置框选区域', () => {
      const box = { x: 10, y: 20, width: 100, height: 200 }
      module.setSelectionBox(box)
      expect(selectionBox.value).toEqual(box)
    })

    it('清除框选区域', () => {
      module.setSelectionBox(null)
      expect(selectionBox.value).toBeNull()
    })
  })

  describe('setSelecting', () => {
    it('设置框选模式', () => {
      module.setSelecting(true)
      expect(isSelecting.value).toBe(true)
    })
  })
})

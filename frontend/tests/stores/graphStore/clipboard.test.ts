import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowRef, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
  addEdges: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { addNodes, addEdges } from '@/services/canvas/vueFlowApi'
import { createClipboardModule } from '@/stores/graphStore/modules/clipboard'

function makeNode(id: string, type = 'schema', data: Record<string, unknown> = {}): CustomNode {
  return {
    id,
    type,
    position: { x: 100, y: 200 },
    data: { configName: `node_${id}`, saveState: 'saved', ...data } as CustomNodeData,
  } as CustomNode
}

describe('createClipboardModule', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let selectedNodeId: Ref<string | null>
  let selectedNodeIds: Ref<string[]>
  let copiedNodes: Ref<CustomNode[]>
  let module: ReturnType<typeof createClipboardModule>
  const mockDeleteNode = vi.fn()
  const mockDeleteNodes = vi.fn()
  const mockSaveState = vi.fn()
  const mockReconcileAll = vi.fn()

  beforeEach(() => {
    nodes = shallowRef<CustomNode[]>([])
    edges = shallowRef<Edge[]>([])
    selectedNodeId = shallowRef<string | null>(null)
    selectedNodeIds = shallowRef<string[]>([])
    copiedNodes = shallowRef<CustomNode[]>([])

    module = createClipboardModule({
      nodes,
      edges,
      selectedNodeId,
      selectedNodeIds,
      copiedNodes,
      deleteNode: mockDeleteNode,
      deleteNodes: mockDeleteNodes,
      saveState: mockSaveState,
      reconcileAll: mockReconcileAll,
    })

    vi.mocked(addNodes).mockClear()
    vi.mocked(addEdges).mockClear()
    mockDeleteNode.mockClear()
    mockDeleteNodes.mockClear()
    mockSaveState.mockClear()
    mockReconcileAll.mockClear()
  })

  describe('copySelectedNodes', () => {
    it('复制单选节点', () => {
      nodes.value = [makeNode('n1')]
      selectedNodeId.value = 'n1'

      module.copySelectedNodes()

      expect(copiedNodes.value).toHaveLength(1)
      expect(copiedNodes.value[0].id).toBe('n1')
    })

    it('复制多选节点', () => {
      nodes.value = [makeNode('n1'), makeNode('n2')]
      selectedNodeIds.value = ['n1', 'n2']

      module.copySelectedNodes()

      expect(copiedNodes.value).toHaveLength(2)
    })

    it('无选中时不操作', () => {
      module.copySelectedNodes()
      expect(copiedNodes.value).toHaveLength(0)
    })
  })

  describe('pasteNodes', () => {
    it('粘贴节点并创建新 ID', async () => {
      copiedNodes.value = [makeNode('n1')]

      const result = await module.pasteNodes()

      expect(result).toHaveLength(1)
      expect(result[0]).not.toBe('n1')
      expect(addNodes).toHaveBeenCalledTimes(1)
    })

    it('位置偏移', async () => {
      copiedNodes.value = [makeNode('n1')]
      nodes.value = []

      await module.pasteNodes()

      const node = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
      expect(node.position.x).toBe(120)
      expect(node.position.y).toBe(220)
    })

    it('连续粘贴偏移递增', async () => {
      copiedNodes.value = [makeNode('n1')]
      nodes.value = []

      await module.pasteNodes()
      const pos1 = (vi.mocked(addNodes).mock.calls[0][0] as CustomNode).position

      nodes.value = [...nodes.value, makeNode('new1')]
      await module.pasteNodes()
      const pos2 = (vi.mocked(addNodes).mock.calls[1][0] as CustomNode).position

      expect(pos2.x).toBeGreaterThan(pos1.x)
    })

    it('空剪贴板返回空数组', async () => {
      const result = await module.pasteNodes()
      expect(result).toEqual([])
    })

    it('复制内部边', async () => {
      copiedNodes.value = [makeNode('n1'), makeNode('n2')]
      edges.value = [{ id: 'e1', source: 'n1', target: 'n2' } as Edge]
      nodes.value = []

      await module.pasteNodes()

      expect(addEdges).toHaveBeenCalledTimes(1)
    })

    it('调用 reconcileAll', async () => {
      copiedNodes.value = [makeNode('n1')]
      nodes.value = []

      await module.pasteNodes()

      expect(mockReconcileAll).toHaveBeenCalled()
    })
  })

  describe('cutSelectedNodes', () => {
    it('复制后删除原节点', async () => {
      nodes.value = [makeNode('n1')]
      selectedNodeIds.value = ['n1']

      await module.cutSelectedNodes()

      expect(copiedNodes.value).toHaveLength(1)
      expect(mockDeleteNodes).toHaveBeenCalledWith(['n1'])
    })

    it('无选中时不操作', async () => {
      await module.cutSelectedNodes()
      expect(mockDeleteNodes).not.toHaveBeenCalled()
    })
  })

  describe('duplicateSelectedNode', () => {
    it('复制并粘贴单个节点', async () => {
      nodes.value = [makeNode('n1')]
      selectedNodeId.value = 'n1'

      const newId = await module.duplicateSelectedNode()

      expect(newId).not.toBeNull()
      expect(newId).not.toBe('n1')
      expect(addNodes).toHaveBeenCalledTimes(1)
      expect(selectedNodeId.value).toBe(newId)
    })

    it('无选中时返回 null', async () => {
      const result = await module.duplicateSelectedNode()
      expect(result).toBeNull()
    })

    it('多选时返回 null', async () => {
      nodes.value = [makeNode('n1'), makeNode('n2')]
      selectedNodeIds.value = ['n1', 'n2']

      const result = await module.duplicateSelectedNode()
      expect(result).toBeNull()
    })

    it('复制关联边', async () => {
      nodes.value = [makeNode('n1'), makeNode('n2')]
      edges.value = [{ id: 'e1', source: 'n1', target: 'n2' } as Edge]
      selectedNodeId.value = 'n1'

      await module.duplicateSelectedNode()

      expect(addEdges).toHaveBeenCalled()
    })
  })
})

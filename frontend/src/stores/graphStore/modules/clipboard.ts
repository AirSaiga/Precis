/**
 * @file clipboard.ts
 * @description 画布节点剪贴板操作（复制/粘贴/重复/剪切）
 *
 * 该模块封装对选中节点的复制、粘贴、重复与剪切逻辑。
 * 采用依赖注入方式接入 graphStore，避免循环依赖。
 */

import type { Ref } from 'vue'
import { nextTick } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { addNodes, addEdges } from '@/services/canvas/vueFlowApi'
export function createClipboardModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  selectedNodeIds: Ref<string[]>
  copiedNodes: Ref<CustomNode[]>
  deleteNode: (nodeId: string) => void
  deleteNodes: (nodeIds: string[]) => void
  saveState: () => void
  pasteOffset?: { x: number; y: number }
  reconcileAll: () => void | Promise<void>
}) {
  const {
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    copiedNodes,
    deleteNodes,
    saveState,
    reconcileAll,
  } = params
  const pasteOffset = params.pasteOffset ?? { x: 20, y: 20 }

  // 累积粘贴偏移，每次粘贴后递增，避免节点堆叠
  let currentPasteOffset = { x: pasteOffset.x, y: pasteOffset.y }

  /**
   * 获取当前应复制的节点列表
   * 优先使用多选列表，回退到单选
   */
  function getNodesToCopy(): CustomNode[] {
    if (selectedNodeIds.value.length > 0) {
      const ids = new Set(selectedNodeIds.value)
      return nodes.value.filter((n) => ids.has(n.id))
    }
    if (selectedNodeId.value) {
      const node = nodes.value.find((n) => n.id === selectedNodeId.value)
      return node ? [node] : []
    }
    return []
  }

  /**
   * 重置累积粘贴偏移
   */
  function resetPasteOffset() {
    currentPasteOffset = { x: pasteOffset.x, y: pasteOffset.y }
  }

  /**
   * 重置复制节点的状态（saveState 等）
   */
  function resetCopiedNodeState(node: CustomNode) {
    if (node.data && typeof node.data === 'object') {
      ;(node.data as unknown as Record<string, unknown>).saveState = 'draft'
      delete (node.data as unknown as Record<string, unknown>).parent
    }
  }

  /**
   * 替换 edge handle 中的旧节点 ID 为新节点 ID
   */
  function remapHandle(
    handle: string | undefined | null,
    idMap: Map<string, string>
  ): string | undefined {
    if (!handle) return handle ?? undefined
    let result = handle
    for (const [oldId, newId] of idMap.entries()) {
      if (result.includes(oldId)) {
        result = result.split(oldId).join(newId)
      }
    }
    return result
  }

  /**
   * 更新 conditional 约束节点数据中的 edgeId 引用
   */
  function remapConditionalEdgeIds(
    nodeData: Record<string, unknown>,
    edgeIdMap: Map<string, string>
  ) {
    const ifConditions = nodeData.ifConditions as Array<{ edgeId?: string }> | undefined
    if (!Array.isArray(ifConditions)) return
    for (const condition of ifConditions) {
      if (condition.edgeId && edgeIdMap.has(condition.edgeId)) {
        condition.edgeId = edgeIdMap.get(condition.edgeId)
      }
    }
  }

  /**
   * 剪切选中节点：复制节点后删除原节点
   */
  async function cutSelectedNodes() {
    const nodesToCopy = getNodesToCopy()
    if (nodesToCopy.length === 0) {
      return
    }

    saveState()
    copiedNodes.value = nodesToCopy.map((node) => structuredClone(node))
    deleteNodes(nodesToCopy.map((n) => n.id))
  }

  /**
   * 复制选中的节点
   */
  function copySelectedNodes() {
    const nodesToCopy = getNodesToCopy()
    if (nodesToCopy.length === 0) {
      return
    }

    copiedNodes.value = nodesToCopy.map((node) => structuredClone(node))
    resetPasteOffset()
  }

  /**
   * 粘贴复制的节点
   *
   * 同时复制 copiedNodes 中节点之间的关联边。
   */
  async function pasteNodes(): Promise<string[]> {
    if (copiedNodes.value.length === 0) {
      return []
    }

    saveState()

    const newNodeIds: string[] = []
    const idMap = new Map<string, string>()

    for (const copiedNode of copiedNodes.value) {
      const newId = uuidv4()
      idMap.set(copiedNode.id, newId)

      const newNode: CustomNode = {
        ...copiedNode,
        id: newId,
        data: structuredClone(copiedNode.data),
        position: {
          x: copiedNode.position.x + currentPasteOffset.x,
          y: copiedNode.position.y + currentPasteOffset.y,
        },
      }

      resetCopiedNodeState(newNode)
      addNodes(newNode)
      newNodeIds.push(newNode.id)
    }

    // 等待节点渲染，获得 handleBounds 后再创建边
    await nextTick()

    // 复制 copiedNodes 中节点之间的内部边
    const copiedNodeIds = new Set(copiedNodes.value.map((n) => n.id))
    const edgesToCopy = edges.value.filter(
      (e) => copiedNodeIds.has(e.source) && copiedNodeIds.has(e.target)
    )

    const edgeIdMap = new Map<string, string>()

    for (const edge of edgesToCopy) {
      const newSourceId = idMap.get(edge.source)
      const newTargetId = idMap.get(edge.target)
      if (!newSourceId || !newTargetId) continue

      const newEdgeId = uuidv4()
      edgeIdMap.set(edge.id, newEdgeId)

      const newEdge: Edge = {
        ...edge,
        id: newEdgeId,
        source: newSourceId,
        target: newTargetId,
        sourceHandle: remapHandle(edge.sourceHandle, idMap),
        targetHandle: remapHandle(edge.targetHandle, idMap),
      }

      addEdges(newEdge)
    }

    // 更新 conditional 约束节点数据中的 edgeId 引用
    for (const newNode of nodes.value) {
      if (!newNodeIds.includes(newNode.id)) continue
      if (newNode.type === 'conditionalConstraint' && newNode.data) {
        remapConditionalEdgeIds(newNode.data as unknown as Record<string, unknown>, edgeIdMap)
      }
    }

    // 递增粘贴偏移
    currentPasteOffset.x += pasteOffset.x
    currentPasteOffset.y += pasteOffset.y

    if (newNodeIds.length > 0) {
      const lastId = newNodeIds[newNodeIds.length - 1]
      if (lastId !== undefined) {
        selectedNodeId.value = lastId
      }
      selectedNodeIds.value = newNodeIds
    }

    await reconcileAll()
    return newNodeIds
  }

  /**
   * 复制并粘贴选中节点（Ctrl/Cmd+D）
   *
   * 同时复制与该节点关联的边，更新 source/target 指向新节点。
   */
  async function duplicateSelectedNode(): Promise<string | null> {
    const nodesToCopy = getNodesToCopy()
    if (nodesToCopy.length === 0) {
      return null
    }

    if (nodesToCopy.length > 1) {
      return null
    }

    saveState()

    const nodeToCopy = nodesToCopy[0]
    if (!nodeToCopy) {
      return null
    }
    const newId = uuidv4()
    const idMap = new Map<string, string>()
    idMap.set(nodeToCopy.id, newId)

    const newNode: CustomNode = {
      ...nodeToCopy,
      id: newId,
      data: structuredClone(nodeToCopy.data),
      position: {
        x: nodeToCopy.position.x + pasteOffset.x,
        y: nodeToCopy.position.y + pasteOffset.y,
      },
    }

    resetCopiedNodeState(newNode)
    addNodes(newNode)
    selectedNodeId.value = newNode.id
    selectedNodeIds.value = [newNode.id]

    // 等待节点渲染，获得 handleBounds 后再创建边
    await nextTick()

    // 复制与该节点关联的边，更新 source/target 指向新节点
    const relatedEdges = edges.value.filter(
      (e) => e.source === nodeToCopy.id || e.target === nodeToCopy.id
    )

    const edgeIdMap = new Map<string, string>()

    for (const edge of relatedEdges) {
      const newEdgeId = uuidv4()
      edgeIdMap.set(edge.id, newEdgeId)

      const isSource = edge.source === nodeToCopy.id
      const isTarget = edge.target === nodeToCopy.id

      const newEdge: Edge = {
        ...edge,
        id: newEdgeId,
        source: isSource ? newId : edge.source,
        target: isTarget ? newId : edge.target,
        sourceHandle: remapHandle(edge.sourceHandle, idMap),
        targetHandle: remapHandle(edge.targetHandle, idMap),
      }

      addEdges(newEdge)
    }

    // 更新 conditional 约束节点数据中的 edgeId 引用
    if (newNode.type === 'conditionalConstraint' && newNode.data) {
      remapConditionalEdgeIds(newNode.data as unknown as Record<string, unknown>, edgeIdMap)
    }

    await reconcileAll()
    return newNode.id
  }

  return {
    cutSelectedNodes,
    copySelectedNodes,
    pasteNodes,
    duplicateSelectedNode,
  }
}

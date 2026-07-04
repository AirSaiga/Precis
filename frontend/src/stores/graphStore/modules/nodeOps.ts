/**
 * @file nodeOps.ts
 * @description 节点操作模块（删除、批量删除、移动）
 *
 * 包含:
 * - deleteNode: 删除单个节点（级联收集子节点/输出节点）
 * - deleteNodes: 批量删除节点
 * - moveSelectedNode / moveSelectedNodes: 移动选中节点
 *
 * 所有操作遵循 Vue Flow API 增量变更路径（addNodes/removeNodes/removeEdges），
 * 完成后调用 reconcileAll 同步 parent/children/outputPortConnected 状态。
 */

import { nextTick } from 'vue'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { removeEdges, removeNodes, updateNode } from '@/services/canvas/vueFlowApi'
import { logger } from '@/core/utils/logger'

interface TemplateExpandLike {
  getExpandedIds(instanceNodeId: string): string[]
  clearExpansion(instanceNodeId: string): void | Promise<void>
}

export interface NodeOpsDeps {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  selectedNodeId: Ref<string | null>
  selectedNodeIds: Ref<string[]>
  reconcileAll: () => void | Promise<void>
  templateExpand: TemplateExpandLike
  clearExpansion: (instanceNodeId: string) => void | Promise<void>
  sourceIndex?: { rebuild: () => void }
}

export function createNodeOpsModule(deps: NodeOpsDeps) {
  const {
    nodes,
    edges,
    selectedNodeId,
    selectedNodeIds,
    reconcileAll,
    templateExpand,
    clearExpansion,
    sourceIndex,
  } = deps

  function onNodesRemoved() {
    sourceIndex?.rebuild()
  }

  function collectCascadeNodeIds(nodeId: string): string[] {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (!node) return [nodeId]

    if (node.type === 'templateInstance') {
      return [nodeId, ...templateExpand.getExpandedIds(nodeId)]
    }

    if (node.type !== 'transform') {
      return [nodeId]
    }

    const transformData = (node.data || {}) as Record<string, unknown>
    const outputNodeIds = Array.isArray(transformData.outputNodeIds)
      ? (transformData.outputNodeIds as string[])
      : []

    const childIdsByParentRef = nodes.value
      .filter((candidate) => {
        if (candidate.type !== 'transformOutput') return false
        const outputData = (candidate.data || {}) as Record<string, unknown>
        return outputData.parentTransformId === nodeId
      })
      .map((candidate) => candidate.id)

    return Array.from(new Set([nodeId, ...outputNodeIds, ...childIdsByParentRef]))
  }

  async function deleteNode(nodeId: string) {
    const node = nodes.value.find((n) => n.id === nodeId)
    if (node?.type === 'projectRoot') {
      return
    }

    // templateInstance 删除前清理展开追踪状态(expandedNodeIds Map、expanded 标志)
    if (node?.type === 'templateInstance') {
      await clearExpansion(nodeId)
    }

    const deleteIds = collectCascadeNodeIds(nodeId)
    const nodeIdSet = new Set(deleteIds)

    const relatedEdges = edges.value.filter(
      (e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target)
    )
    for (const edge of relatedEdges) {
      removeEdges(edge.id)
    }

    removeNodes(deleteIds)

    selectedNodeIds.value = selectedNodeIds.value.filter((id) => !nodeIdSet.has(id))

    if (selectedNodeId.value && nodeIdSet.has(selectedNodeId.value)) {
      selectedNodeId.value = null
    }

    nextTick(async () => {
      await reconcileAll()
      onNodesRemoved()
    })
  }

  function deleteNodes(nodeIds: string[]) {
    const filteredIds = nodeIds.filter((id) => {
      const node = nodes.value.find((n) => n.id === id)
      return node?.type !== 'projectRoot'
    })

    if (filteredIds.length === 0) {
      return
    }

    const deleteIds = Array.from(new Set(filteredIds.flatMap((id) => collectCascadeNodeIds(id))))
    const nodeIdSet = new Set(deleteIds)

    const relatedEdges = edges.value.filter(
      (e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target)
    )
    for (const edge of relatedEdges) {
      removeEdges(edge.id)
    }

    removeNodes(deleteIds)

    selectedNodeIds.value = selectedNodeIds.value.filter((id) => !nodeIdSet.has(id))

    if (selectedNodeId.value && nodeIdSet.has(selectedNodeId.value)) {
      selectedNodeId.value = null
    }

    nextTick(async () => {
      await reconcileAll()
      onNodesRemoved()
    })
  }

  function moveSelectedNode(deltaX: number, deltaY: number) {
    if (!selectedNodeId.value) {
      return
    }

    const node = nodes.value.find((n) => n.id === selectedNodeId.value)
    if (!node) {
      return
    }

    const nextPosition = {
      x: node.position.x + deltaX,
      y: node.position.y + deltaY,
    }
    // position 是 Node 级字段(不在 data 中),统一通过 updateNode 入口同步给 Vue Flow
    try {
      updateNode(node.id, { position: nextPosition })
    } catch (e) {
      // Vue Flow 未初始化时不再 fallback 到直接 mutate node.position(违例)
      logger.warn('[nodeOps] moveSelectedNode: Vue Flow API 未初始化,跳过移动', e)
    }
  }

  function moveSelectedNodes(deltaX: number, deltaY: number) {
    if (selectedNodeIds.value.length === 0) {
      return
    }

    for (const node of nodes.value) {
      if (selectedNodeIds.value.includes(node.id)) {
        const nextPosition = {
          x: node.position.x + deltaX,
          y: node.position.y + deltaY,
        }

        try {
          updateNode(node.id, { position: nextPosition })
        } catch (e) {
          logger.warn('[nodeOps] moveSelectedNodes: Vue Flow API 未初始化,跳过移动', e)
        }
      }
    }
  }

  return {
    deleteNode,
    deleteNodes,
    moveSelectedNode,
    moveSelectedNodes,
  }
}

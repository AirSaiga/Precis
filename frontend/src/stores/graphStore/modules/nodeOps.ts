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
    // 防御性 try/catch: clearExpansion 失败不应阻断节点删除本身
    if (node?.type === 'templateInstance') {
      try {
        await clearExpansion(nodeId)
      } catch (e) {
        logger.warn('[nodeOps] deleteNode: clearExpansion 失败,继续删除节点', e)
      }
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
      // 防御性 try/catch:reconcileAll 失败不应导致未处理的 Promise 拒绝
      // (deleteNode 多由 fire-and-forget 的 UI 事件处理器调用,无调用方接住 rejection)
      try {
        await reconcileAll()
      } catch (e) {
        logger.warn('[nodeOps] deleteNode: reconcileAll 失败', e)
      }
      onNodesRemoved()
    })
  }

  async function deleteNodes(nodeIds: string[]) {
    const filteredIds = nodeIds.filter((id) => {
      const node = nodes.value.find((n) => n.id === id)
      return node?.type !== 'projectRoot'
    })

    if (filteredIds.length === 0) {
      return
    }

    // templateInstance 节点删除前清理展开追踪状态(与 deleteNode 单条路径对称)
    // 必须在 collectCascadeNodeIds 之前执行,否则 getExpandedIds 仍返回子节点造成重复收集
    // 防御性 try/catch: clearExpansion 失败不应阻断节点删除本身
    for (const id of filteredIds) {
      const node = nodes.value.find((n) => n.id === id)
      if (node?.type === 'templateInstance') {
        try {
          await clearExpansion(id)
        } catch (e) {
          logger.warn('[nodeOps] deleteNodes: clearExpansion 失败,继续删除节点', e)
        }
      }
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
      // 防御性 try/catch:同 deleteNode,避免 fire-and-forget 调用方的未处理 rejection
      try {
        await reconcileAll()
      } catch (e) {
        logger.warn('[nodeOps] deleteNodes: reconcileAll 失败', e)
      }
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

    const selectedIdSet = new Set(selectedNodeIds.value)
    for (const node of nodes.value) {
      if (!selectedIdSet.has(node.id)) continue
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

  return {
    deleteNode,
    deleteNodes,
    moveSelectedNode,
    moveSelectedNodes,
  }
}

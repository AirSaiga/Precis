/**
 * @file connectionOps.ts
 * @description 画布连接操作模块 - 管理节点之间的连接关系
 *
 * 所有边增删通过 Vue Flow 原生 API（vueFlowApi 模块）执行，
 * 确保 Vue Flow 内部状态一致、hooks 正确触发。
 *
 * @module graphStore/modules
 */

import { logger } from '@/core/utils/logger'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { executeDisconnectCleanup } from '@/services/disconnect'
import type { DisconnectContext } from '@/services/disconnect'
import { addEdges, removeEdges, findEdge } from '@/services/canvas/vueFlowApi'
import { EDGE_DRAW_DURATION_MS, EDGE_DRAWING_CLASS } from '@/services/canvas/animationDurations'

export function createConnectionOpsModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
  clearAllValidationErrors: (schemaNodeId: string) => void
  syncOnDisconnect: (edge: Edge) => void
}) {
  const { nodes, edges, updateNodeData, clearAllValidationErrors, syncOnDisconnect } = params

  /**
   * 清除边上的临时动画 class。
   *
   * 关键约束：必须用 findEdge 增量改 Vue Flow 内部响应式 GraphEdge 的 class，
   * 不能用 edges.value = [...] 全量替换——全量替换会走 setEdges，触发对每条边
   * 重新 findNode 校验，导致边被静默丢弃（边消失）并触发 onEdgesChange remove 链路。
   * 此处的直接赋值是增量更新，与 useVirtualAnchorEdges / regexValidationHandler 一致。
   */
  function clearEdgeClass(edgeId: string, className: string): void {
    const vfEdge = findEdge(edgeId)
    if (vfEdge && vfEdge.class === className) {
      vfEdge.class = undefined
    }
  }

  function createConnection(
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle?: string,
    targetHandle?: string,
    options?: Partial<Edge>
  ) {
    logger.debug('🔄 graphStore.createConnection:', {
      sourceNodeId,
      targetNodeId,
      sourceHandle,
      targetHandle,
      options,
    })

    const newEdge: Edge = {
      id: uuidv4(),
      source: sourceNodeId,
      target: targetNodeId,
      sourceHandle,
      targetHandle,
      // 标记绘制渐入动画；Vue Flow 原生支持 edge.class，渲染时附加到边元素
      class: EDGE_DRAWING_CLASS,
      ...options,
    }

    addEdges(newEdge)
    // 动画结束后清除 class（仅作用于交互连线；批量程序化连线不触发）
    setTimeout(() => clearEdgeClass(newEdge.id, EDGE_DRAWING_CLASS), EDGE_DRAW_DURATION_MS)
    logger.debug('✅ 连接创建成功')
    return newEdge.id
  }

  function deleteConnection(edgeId: string) {
    removeEdges(edgeId)
  }

  function handleEdgeRemoved(edge: Edge) {
    if (
      (edge as unknown as Record<string, unknown>)?.data &&
      ((edge as unknown as Record<string, unknown>).data as Record<string, unknown>)?.transient
    )
      return

    const sourceNode = nodes.value.find((n) => n.id === edge.source)
    const targetNode = nodes.value.find((n) => n.id === edge.target)

    syncOnDisconnect(edge)

    const ctx: DisconnectContext = {
      nodes,
      edges,
      updateNodeData,
      syncOnDisconnect,
      clearAllValidationErrors,
    }
    executeDisconnectCleanup(edge, sourceNode, targetNode, ctx)
  }

  return {
    createConnection,
    deleteConnection,
    handleEdgeRemoved,
  }
}

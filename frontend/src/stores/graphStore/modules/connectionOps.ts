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
import { addEdges, removeEdges } from '@/services/canvas/vueFlowApi'

export function createConnectionOpsModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
  clearAllValidationErrors: (schemaNodeId: string) => void
  syncOnDisconnect: (edge: Edge) => void
}) {
  const { nodes, edges, updateNodeData, clearAllValidationErrors, syncOnDisconnect } = params

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
      ...options,
    }

    addEdges(newEdge)
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

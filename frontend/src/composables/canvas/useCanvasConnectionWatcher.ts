/**
 * @file useCanvasConnectionWatcher.ts
 * @description 画布连接监听组合式函数
 *
 * 职责：
 * - 连接有效性验证
 * - 通过 Vue Flow 的 onEdgesChange 事件检测边移除，触发清理
 *
 * 所有边删除（UI / 程序化）统一走 removeEdges → onEdgesChange → handleEdgeRemoved。
 * removeEdges 同步触发 onEdgesChange，此时 edges.value 中仍可查到边数据。
 */

import type { Connection, Edge, EdgeChange, Node } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { connectionPolicyService } from '@/services/canvas/connectionPolicyService'

export function useCanvasConnectionWatcher() {
  const store = useGraphStore()

  const validateConnection = (
    connection: Connection,
    context?: { nodes?: Node[]; edges?: Edge[]; sourceNode?: Node; targetNode?: Node }
  ) => {
    const nodes = context?.nodes ?? store.nodes
    const edges = context?.edges ?? store.edges
    return connectionPolicyService.isValidConnection(connection, nodes, edges)
  }

  const { onEdgesChange } = useVueFlow()

  onEdgesChange((changes: EdgeChange[]) => {
    const removedChanges = changes.filter((c) => c.type === 'remove')
    if (removedChanges.length === 0) return

    // 用户断线（非复合操作级联清理）：清理前压一份撤销快照。
    // 节点删除 / 模板展开等复合操作已各自压栈并挂起历史（isHistorySuspended），
    // 期间的级联边移除不重复压栈。onEdgesChange 触发时 store.edges 尚未同步移除，
    // 快照仍包含被删边，可正确恢复。
    const hasUserRemoval = removedChanges.some((c) => {
      const edge = store.edges.find((e) => e.id === c.id)
      return edge && !(edge as unknown as { data?: { transient?: boolean } }).data?.transient
    })
    if (hasUserRemoval && !store.isHistorySuspended()) {
      store.saveState()
    }

    // 清理链（syncOnDisconnect/executeDisconnectCleanup）可能连带移除更多边，
    // 挂起历史避免同一次断线压多份快照
    const outerSuspended = store.isHistorySuspended()
    if (!outerSuspended) store.suspendHistory()
    try {
      for (const change of removedChanges) {
        const edge = store.edges.find((e) => e.id === change.id)
        if (edge) {
          store.handleEdgeRemoved(edge)
        }
      }
    } finally {
      if (!outerSuspended) store.resumeHistory()
    }
  })

  return {
    validateConnection,
  }
}

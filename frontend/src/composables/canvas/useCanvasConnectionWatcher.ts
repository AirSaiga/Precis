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

import type { Connection, EdgeChange } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { connectionPolicyService } from '@/services/canvas/connectionPolicyService'

export function useCanvasConnectionWatcher() {
  const store = useGraphStore()

  const validateConnection = (connection: Connection) => {
    return connectionPolicyService.isValidConnection(connection, store.nodes)
  }

  const { onEdgesChange } = useVueFlow()

  onEdgesChange((changes: EdgeChange[]) => {
    const removedChanges = changes.filter((c) => c.type === 'remove')
    for (const change of removedChanges) {
      const edge = store.edges.find((e) => e.id === change.id)
      if (edge) {
        store.handleEdgeRemoved(edge)
      }
    }
  })

  return {
    validateConnection,
  }
}

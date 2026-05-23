/**
 * @file useCanvasConnectionWatcher.ts
 * @description 画布连接监听组合式函数
 *
 * 职责：
 * - 连接有效性验证
 * - 监听边数据变化，检测被移除的边并触发清理
 */

import { ref, watch } from 'vue'
import type { Connection } from '@vue-flow/core'
import { useGraphStore } from '@/stores/graphStore'
import { connectionPolicyService } from '@/services/canvas/connectionPolicyService'

/**
 * @description 画布连接监听组合式函数
 * @description 提供连接有效性验证，并监听边的增删变化以触发清理逻辑
 * @returns validateConnection 验证函数和 previousEdges 边的历史引用
 */
export function useCanvasConnectionWatcher() {
  const store = useGraphStore()

  /**
   * @description 验证连接是否有效
   * @param connection - 连接对象，包含源节点、目标节点和手柄信息
   * @returns 连接是否通过策略验证
   */
  const validateConnection = (connection: Connection) => {
    return connectionPolicyService.isValidConnection(
      connection,
      store.nodes,
      store.edges
    )
  }

  // 维护上一次边的状态映射，用于检测被移除的边
  const previousEdges = ref<Map<string, any>>(new Map())

  // 监听边数据变化，检测被移除的边并触发清理
  watch(
    store.edges,
    (nextEdges, prevEdges) => {
      // 将上一次边数据转换为数组格式
      const prevList = Array.isArray(prevEdges) ? prevEdges : []
      // 构建当前边 ID 的集合，用于快速查找
      const nextIds = new Set((nextEdges || []).map((e) => e.id))
      // 过滤出在本次变化中被移除的边
      const removed = prevList.filter((e) => !nextIds.has(e.id))

      // 对每个被移除的边触发 Store 中的清理逻辑
      removed.forEach((edge) => {
        store.handleEdgeRemoved(edge)
      })

      // 更新边历史记录为当前状态
      previousEdges.value = new Map((nextEdges || []).map((e) => [e.id, e]))
    },
    { deep: false }
  )

  return {
    validateConnection,
    previousEdges,
  }
}

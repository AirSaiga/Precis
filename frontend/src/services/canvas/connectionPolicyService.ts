/**
 * @file connectionPolicyService.ts
 * @description 连接策略服务
 *
 * 该模块提供连接策略的统一接口，用于 VueFlow 组件的连接验证。
 * 当前仅保留生产消费方使用的 isValidConnection（VueFlow isValidConnection 属性）。
 *
 * 依赖说明：
 * - composables/validation/useConnectionValidator: 连接验证器
 */

import type { Connection, Edge, Node } from '@vue-flow/core'
import { useConnectionValidator } from '../../composables/validation/useConnectionValidator'

class ConnectionPolicyServiceClass {
  /**
   * VueFlow 专用：判断连接是否有效
   * 供 VueFlow 组件的 isValidConnection 属性使用
   *
   * @param connection - VueFlow 连接对象
   * @param nodes - 节点列表
   * @returns 连接是否有效
   */
  isValidConnection(connection: Connection, nodes: Node[], edges: Edge[] = []): boolean {
    const sourceNode = nodes.find((n) => n.id === connection.source)
    const targetNode = nodes.find((n) => n.id === connection.target)

    if (!sourceNode || !targetNode) {
      return false
    }

    const { validateConnection } = useConnectionValidator({
      existingConnections: edges as Connection[],
    })

    const result = validateConnection(
      sourceNode,
      connection.sourceHandle ?? undefined,
      targetNode,
      connection.targetHandle ?? undefined
    )

    return result.isValid
  }
}

export const connectionPolicyService = new ConnectionPolicyServiceClass()

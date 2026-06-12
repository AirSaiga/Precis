/**
 * @file connectionPolicyService.ts
 * @description 连接策略服务
 *
 * 该模块提供连接策略的统一接口，用于 VueFlow 组件的连接验证。
 * 封装连接规则查询、连接有效性判断和无效连接清理等功能。
 *
 * 功能概述：
 * 1. 连接有效性判断 - 判断连接是否符合规则
 * 2. 可连接目标查询 - 获取节点的可连接目标列表
 * 3. 连接清理 - 清理无效的现有连接
 * 4. 规则查询 - 查询特定节点类型相关的连接规则
 *
 * 架构设计：
 * - 策略模式 - 将连接验证逻辑封装为独立的策略服务
 * - 静态方法 - 提供静态方法供 VueFlow 直接使用
 * - 类型安全 - 使用 TypeScript 确保类型安全
 *
 * 依赖说明：
 * - core/rules/connectionRules: 连接规则定义
 * - composables/validation/useConnectionValidator: 连接验证器
 *
 * 使用场景：
 * - VueFlow 组件的 isValidConnection 属性
 * - 连接高亮提示
 * - 现有连接清理
 */

import type { Connection, Edge, Node } from '@vue-flow/core'
import { useConnectionValidator } from '../../composables/validation/useConnectionValidator'
import { connectionRules, type ConnectionRule } from '@/services/rules'

export interface NodeConnectionInfo {
  nodeId: string
  nodeType: string
  handles: string[]
}

export interface InvalidConnection {
  connection: Connection
  reason: string
}

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

  /**
   * 获取节点的可用连接目标列表
   * 可用于高亮提示或连接建议
   *
   * @param nodeId - 源节点 ID
   * @param handleId - 源句柄 ID
   * @param nodes - 节点列表
   * @returns 可连接的目标节点信息列表
   */
  getAllowedTargets(
    nodeId: string,
    handleId: string | undefined,
    nodes: Node[],
    edges: Edge[] = []
  ): Array<{ node: Node; handle?: string }> {
    const sourceNode = nodes.find((n) => n.id === nodeId)

    if (!sourceNode) {
      return []
    }

    const { getAllowedTargetsForSource } = useConnectionValidator({
      existingConnections: edges as Connection[],
    })

    const allowedTargets = getAllowedTargetsForSource(sourceNode, handleId, nodes)

    return allowedTargets.map((item) => ({
      node: item.node,
      handle: item.handle,
    }))
  }

  /**
   * 批量检查并清理无效连接
   *
   * @param nodes - 节点列表
   * @param connections - 连接列表
   * @returns 无效连接列表
   */
  sanitizeConnections(nodes: Node[], connections: Connection[]): InvalidConnection[] {
    const { sanitizeConnections: validateAndSanitize } = useConnectionValidator({
      existingConnections: connections,
    })

    const validConnections = validateAndSanitize(nodes, connections)
    const invalidConnections: InvalidConnection[] = []

    for (const conn of connections) {
      if (!isConnectionInList(conn, validConnections)) {
        invalidConnections.push({
          connection: conn,
          reason: 'Connection validation failed',
        })
      }
    }

    return invalidConnections
  }

  /**
   * 获取与特定节点类型相关的连接规则
   *
   * @param nodeType - 节点类型
   * @param isSource - 是否作为源节点
   * @returns 相关的连接规则列表
   */
  getRulesForNodeType(nodeType: string, isSource: boolean = true): ConnectionRule[] {
    if (isSource) {
      return connectionRules.filter((rule: ConnectionRule) =>
        rule.source.nodeTypes.some((t) => t === nodeType)
      )
    } else {
      return connectionRules.filter((rule: ConnectionRule) =>
        rule.target.nodeTypes.some((t) => t === nodeType)
      )
    }
  }

  /**
   * 检查两个节点类型之间是否存在任何有效连接规则
   *
   * @param sourceType - 源节点类型
   * @param targetType - 目标节点类型
   * @returns 是否存在有效规则
   */
  hasValidConnectionRule(sourceType: string, targetType: string): boolean {
    return connectionRules.some(
      (rule: ConnectionRule) =>
        rule.source.nodeTypes.some((t) => t === sourceType) &&
        rule.target.nodeTypes.some((t) => t === targetType)
    )
  }

  /**
   * 获取节点类型的入度（作为目标节点的连接数量限制）
   *
   * @param nodeType - 节点类型
   * @returns 入度配置信息
   */
  getInDegreeConfig(nodeType: string): { max: number; description: string } {
    const configs: Record<string, { max: number; description: string }> = {
      schema: { max: 1, description: 'Schema 节点只能有一个数据源连接' },
      jsonSchema: { max: 1, description: 'JsonSchema 节点只能有一个数据源连接' },
      regex: { max: 1, description: 'Regex 节点只能有一个输入连接' },
      notNullConstraint: { max: 1, description: 'NotNull 约束只能连接一个列' },
      uniqueConstraint: { max: 10, description: 'Unique 约束最多连接10个列' },
      foreignKeyConstraint: { max: 1, description: 'ForeignKey 约束只能连接一个列' },
      allowedValuesConstraint: { max: 1, description: 'AllowedValues 约束只能连接一个列' },
      conditionalConstraint: {
        max: 10,
        description: 'Conditional 约束最多连接10个列（5个IF + 5个THEN）',
      },
      scriptedConstraint: { max: 1, description: 'Scripted 约束只能连接一个列' },
      charsetConstraint: { max: 1, description: 'Charset 约束只能连接一个列' },
      dateLogicConstraint: { max: 1, description: 'DateLogic 约束只能连接一个列' },
      rangeConstraint: { max: 1, description: 'Range 约束只能连接一个列' },
      compositeConstraint: { max: 1, description: 'Composite 约束只能连接一个输入' },
      templateInstance: { max: 1, description: '模板实例只能接收一个数据源输入' },
    }

    return configs[nodeType] || { max: Infinity, description: '无限制' }
  }

  /**
   * 获取节点类型的出度（作为源节点的连接数量限制）
   *
   * @param nodeType - 节点类型
   * @returns 出度配置信息
   */
  getOutDegreeConfig(nodeType: string): { max: number; description: string } {
    const configs: Record<string, { max: number; description: string }> = {
      schema: { max: Infinity, description: 'Schema 列可以连接到多个约束' },
      jsonSchema: { max: Infinity, description: 'JsonSchema 列可以连接到多个约束' },
      sourcePreview: { max: 1, description: 'SourcePreview 只能连接到一个 Schema' },
      jsonSourcePreview: { max: 1, description: 'JsonSourcePreview 只能连接到一个 JsonSchema' },
      regex: { max: 1, description: 'Regex 节点最多一个输出连接' },
      foreignKeyConstraint: { max: Infinity, description: 'ForeignKey 可以显示连接到多个目标表' },
      constraintDashboard: { max: 0, description: 'ConstraintDashboard 不支持输出连接' },
      templateInstance: { max: 0, description: '模板实例不作为数据源输出' },
    }

    return configs[nodeType] || { max: Infinity, description: '无限制' }
  }
}

function isConnectionInList(conn: Connection, list: Connection[]): boolean {
  return list.some(
    (c) =>
      c.source === conn.source &&
      c.target === conn.target &&
      c.sourceHandle === conn.sourceHandle &&
      c.targetHandle === conn.targetHandle
  )
}

export const connectionPolicyService = new ConnectionPolicyServiceClass()

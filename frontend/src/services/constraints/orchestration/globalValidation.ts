/**
 * @file globalValidation.ts
 * @description 全局校验入口 - 协调约束校验执行
 *
 * 统一校验入口层：
 * - validateAllConstraints: 全 Schema 校验（委托 validateConstraintNodesForSchema）
 * - triggerValidationForNode: 非阻塞全 Schema 校验
 * - dispatchValidation: 单列单类型校验（连接时即时反馈）
 *
 * @module globalValidation
 */

import { logger } from '@/core/utils/logger'
import { getSchemaNodeSourceInfo } from './validationCollector'
import type { Node, Edge } from '@vue-flow/core'
import {
  validateConstraintNodesForSchema,
  validateConstraintNode,
  isConstraintNodeType,
  getConstraintMetaByKind,
  syncColumnErrorsForSourceRef,
  type ValidationSummary,
} from '@/services/constraints/validationRegistry'
import type { ConstraintKind } from '@/services/constraints/types'

export type { ValidationSummary as GlobalValidationSummary }

/**
 * 执行全表校验
 *
 * 唯一的全 Schema 校验路径：调用 validateConstraintNodesForSchema，
 * 同时更新各约束节点状态和 Schema 列的 validationErrors。
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @param updateNodeData - 更新节点数据的回调函数
 * @returns 校验摘要
 */
export async function validateAllConstraints(
  schemaNodeId: string,
  nodes: Node[],
  edges: Edge[],
  updateNodeData: (nodeId: string, data: any) => void
): Promise<ValidationSummary> {
  logger.debug(`🔍 开始全表校验: ${schemaNodeId}`)

  const sourceInfo = getSchemaNodeSourceInfo(schemaNodeId, nodes, edges)
  if (!sourceInfo || !(sourceInfo.sourceFilePath || sourceInfo.localPath)) {
    logger.debug('ℹ️ SchemaNode 未连接数据源，跳过校验')
    return { totalConstraints: 0, validConstraints: 0, invalidConstraints: 0, totalErrors: 0 }
  }

  const summary = await validateConstraintNodesForSchema({
    schemaNodeId,
    nodes,
    edges,
    updateNodeData,
  })

  logger.debug(
    `✅ 全表校验完成: ${summary.validConstraints}/${summary.totalConstraints} 通过, 共 ${summary.totalErrors} 个错误`
  )

  return summary
}

/**
 * 触发全表校验（非阻塞入口）
 *
 * 适用于不需要等待校验结果的场景（如事件触发）。
 */
export function triggerValidationForNode(
  schemaNodeId: string,
  nodes: Node[],
  edges: Edge[],
  updateNodeData: (nodeId: string, data: any) => void
): void {
  validateAllConstraints(schemaNodeId, nodes, edges, updateNodeData).catch((error) => {
    logger.error(`❌ 全表校验失败: ${schemaNodeId}`, error)
  })
}

/**
 * 校验分发入口（单约束即时校验）
 *
 * 用于连接建立时的即时反馈。查找 Schema → 约束的边，
 * 调用 validateConstraintNode 执行单个约束校验。
 *
 * @param constraintType - 约束类型（'notNull' | 'unique' 等）
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param columnId - 列 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @param updateNodeData - 更新节点数据的回调函数
 */
export async function dispatchValidation(
  constraintType: string,
  schemaNodeId: string,
  columnId: string,
  nodes: Node[],
  edges: Edge[],
  updateNodeData: (nodeId: string, data: any) => void
): Promise<void> {
  const sourceInfo = getSchemaNodeSourceInfo(schemaNodeId, nodes, edges)

  if (!sourceInfo || !(sourceInfo.sourceFilePath || sourceInfo.localPath)) {
    logger.debug(`ℹ️ SchemaNode ${schemaNodeId} 未连接数据源，跳过 ${constraintType} 校验`)
    return
  }

  const schemaNode = nodes.find(
    (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
  )
  if (!schemaNode) return

  const sourceHandle = `source-right-${columnId}`
  const expectedNodeType = getConstraintMetaByKind(constraintType as ConstraintKind)?.nodeType

  const constraintEdge = edges.find((e) => {
    if (e.source !== schemaNodeId || e.sourceHandle !== sourceHandle) return false
    const targetNode = nodes.find((n) => n.id === e.target)
    if (!targetNode) return false
    if (expectedNodeType && targetNode.type !== expectedNodeType) return false
    return true
  })

  if (!constraintEdge) return

  const constraintNode = nodes.find((n) => n.id === constraintEdge.target)
  if (!constraintNode) return

  try {
    await validateConstraintNode({
      schemaNode,
      constraintNode,
      edge: constraintEdge,
      nodes,
      updateNodeData,
    })

    syncColumnErrorsForSourceRef(schemaNodeId, columnId, nodes, updateNodeData)
  } catch (error) {
    logger.error(`❌ ${constraintType} 校验异常:`, error)
    throw error
  }
}

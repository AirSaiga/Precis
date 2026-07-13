/**
 * @file syncStrategies.ts
 * @description 校验结果渲染同步（Layer 2：渲染副作用收敛）
 *
 * 本层职责：把 Layer 1 算出的校验结果写回节点/边，驱动 UI 渲染。
 * 特征：**全文件唯一持有 updateEdgeData 依赖**——
 * 原散落在 _executeAndSync 中的 updateNodeData + updateEdgeData 调用全部收敛至此。
 *
 * 依赖方向：→ vueFlowApi（边状态同步，驱动粒子着色）
 *              → types（结果类型）
 */

import type { Edge, Node } from '@vue-flow/core'

import { updateEdgeData } from '@/services/canvas/vueFlowApi'

import type { ConstraintValidationResult } from '../types'

// ============================================================================
// 约束节点结果同步
// ============================================================================

/**
 * 把边驱动校验结果写回约束节点（table/column/sourceRef/status/errors/lastValidation）
 *
 * 对应原 _executeAndSync 中的 updateNodeData 调用部分。
 * columnId 由 executor 从 edge.sourceHandle 解析后显式传入，避免反查歧义。
 */
export function syncConstraintNodeResult(params: {
  constraintNode: Node
  schemaNode: Node
  columnId: string
  columnName: string
  result: ConstraintValidationResult
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): void {
  const { constraintNode, schemaNode, columnId, columnName, result, updateNodeData } = params
  updateNodeData(constraintNode.id, {
    table: ((schemaNode.data || {}) as Record<string, unknown>)?.tableName as string,
    column: columnName,
    sourceRef: { nodeId: schemaNode.id, columnId },
    validationStatus: result.status,
    validationErrors: result.validationErrors,
    lastValidation: result.lastValidation,
  })
}

/**
 * 把 inline 校验结果写回约束节点
 *
 * 与 syncConstraintNodeResult 的区别：sourceRef 用固定 '0' 列，table 取数据源 configName。
 */
export function syncInlineConstraintNodeResult(params: {
  constraintNode: Node
  sourceNode: Node
  columnName: string
  result: ConstraintValidationResult
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): void {
  const { constraintNode, sourceNode, columnName, result, updateNodeData } = params
  const sourceData = sourceNode.data as Record<string, unknown>
  updateNodeData(constraintNode.id, {
    table: (sourceData.configName as string) || columnName,
    column: columnName,
    sourceRef: { nodeId: sourceNode.id, columnId: '0' },
    validationStatus: result.status,
    validationErrors: result.validationErrors,
    lastValidation: result.lastValidation,
  })
}

// ============================================================================
// 边状态同步（本文件唯一的 vueFlowApi 依赖）
// ============================================================================

/**
 * 同步校验状态到边，驱动粒子着色
 *
 * 对应原 _executeAndSync:62 行的 updateEdgeData 调用——
 * 原全文件唯一硬编码的 vueFlowApi 调用，现已收敛至本函数。
 */
export function syncEdgeStatus(edge: Edge, status: ConstraintValidationResult['status']): void {
  updateEdgeData(edge.id, { validationStatus: status })
}

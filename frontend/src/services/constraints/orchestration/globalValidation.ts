/**
 * @file globalValidation.ts
 * @description 全局校验入口 - 协调约束收集和校验执行
 *
 * 该模块是全表校验的协调者，负责：
 * - 收集从 SchemaNode 出发的所有约束
 * - 获取数据源信息
 * - 执行批量校验
 * - 将校验结果应用到 SchemaNode
 *
 * 这是全局校验的入口层，连接 validationCollector 和 constraintValidator。
 *
 * @module globalValidation
 */

import { logger } from '@/core/utils/logger'
import {
  collectConnectedConstraints,
  getSchemaNodeSourceInfo,
  type ConstraintInfo,
} from './validationCollector'
import {
  validateConstraints,
  validateConstraint,
  type ValidationResult,
} from './constraintValidator'
import type { Node, Edge } from '@vue-flow/core'
import type { SchemaNodeData } from '@/types/graph'
import { validateConstraintNodesForSchema } from '@/services/constraints/validationRegistry'

/**
 * 全局校验摘要接口
 * 描述全表校验的总体结果统计
 */
export interface GlobalValidationSummary {
  /** 总约束数量 */
  totalConstraints: number
  /** 通过校验的约束数量 */
  validConstraints: number
  /** 未通过校验的约束数量 */
  invalidConstraints: number
  /** 总错误数量 */
  totalErrors: number
  /** 详细校验结果数组 */
  results: ValidationResult[]
}

/**
 * SchemaNode 更新数据接口
 * 描述更新 SchemaNode 所需的列数据结构
 */
export interface SchemaNodeUpdateData {
  /** 列数组 */
  columns: Array<{
    /** 列 ID */
    id: string
    /** 列名称 */
    columnName: string
    /** 校验错误数组（可选） */
    validationErrors?: string[]
    /** 约束配置（可选） */
    constraints?: Record<string, boolean>
  }>
}

/**
 * 执行全表校验
 *
 * 这是全表校验的主函数，协调整个校验流程：
 * 1. 从图中收集所有连接的约束
 * 2. 获取数据源信息
 * 3. 批量执行校验
 * 4. 将结果应用到 SchemaNode
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @param updateNodeData - 更新节点数据的回调函数
 * @returns 全局校验摘要对象，包含统计信息和详细结果
 *
 * @example
 * ```typescript
 * const summary = await validateAllConstraints('schema-1', nodes, edges, updateNodeData);
 * logger.debug(`通过: ${summary.validConstraints}/${summary.totalConstraints}`);
 * ```
 */
export async function validateAllConstraints(
  schemaNodeId: string,
  nodes: Node[],
  edges: Edge[],
  updateNodeData: (nodeId: string, data: any) => void
): Promise<GlobalValidationSummary> {
  logger.debug(`🔍 开始全表校验: ${schemaNodeId}`)

  const constraints = collectConnectedConstraints(schemaNodeId, nodes, edges)

  if (constraints.length === 0) {
    logger.debug('ℹ️ 没有找到连接的约束，跳过校验')
    return {
      totalConstraints: 0,
      validConstraints: 0,
      invalidConstraints: 0,
      totalErrors: 0,
      results: [],
    }
  }

  const sourceInfo = getSchemaNodeSourceInfo(schemaNodeId, nodes, edges)

  if (!sourceInfo || !(sourceInfo.sourceFilePath || sourceInfo.localPath)) {
    logger.debug('ℹ️ SchemaNode 未连接数据源，跳过校验')
    return {
      totalConstraints: 0,
      validConstraints: 0,
      invalidConstraints: 0,
      totalErrors: 0,
      results: [],
    }
  }

  const results = await validateConstraints(constraints, sourceInfo)

  applyValidationResultsToSchemaNode(schemaNodeId, results, nodes, updateNodeData)
  await validateConstraintNodesForSchema({
    schemaNodeId,
    nodes,
    edges,
    updateNodeData,
  })

  const validCount = results.filter((r) => r.isValid).length
  const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0)

  logger.debug(`✅ 全表校验完成: ${validCount}/${results.length} 通过, 共 ${errorCount} 个错误`)

  return {
    totalConstraints: results.length,
    validConstraints: validCount,
    invalidConstraints: results.length - validCount,
    totalErrors: errorCount,
    results,
  }
}

/**
 * 将校验结果应用到 SchemaNode
 *
 * 内部辅助函数，将校验结果更新到 SchemaNode 的列数据中，
 * 设置每列的 validationErrors 字段。
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param results - 校验结果数组
 * @param nodes - 图中所有节点的数组
 * @param updateNodeData - 更新节点数据的回调函数
 */
function applyValidationResultsToSchemaNode(
  schemaNodeId: string,
  results: ValidationResult[],
  nodes: Node[],
  updateNodeData: (nodeId: string, data: any) => void
): void {
  const schemaNode = nodes.find((n) => n.id === schemaNodeId && n.type === 'schema')
  if (!schemaNode) return

  const schemaData = schemaNode.data as SchemaNodeData
  const originalColumns = schemaData.columns || []

  const updatedColumns = originalColumns.map((col: any) => {
    const columnResults = results.filter((r) => r.columnId === col.id)
    if (columnResults.length > 0) {
      const allErrors = columnResults.flatMap((r) => r.errors)
      return {
        ...col,
        validationErrors: allErrors,
      }
    }
    return col
  })

  updateNodeData(schemaNodeId, {
    ...schemaData,
    columns: updatedColumns,
    saveState: 'draft',
    updatedAt: new Date().toISOString(),
  })

  logger.debug(`📊 已更新 SchemaNode ${schemaNodeId} 的校验结果`)
}

/**
 * 触发全表校验（非异步入口）
 *
 * 该函数是 validateAllConstraints 的同步封装，
 * 适用于不需要等待校验结果的场景（如事件触发）。
 * 内部会捕获并处理任何异常。
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @param updateNodeData - 更新节点数据的回调函数
 *
 * @example
 * ```typescript
 * // 在事件处理中调用
 * triggerValidationForNode('schema-1', nodes, edges, updateNodeData);
 * ```
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
 * 校验分发入口
 *
 * 该函数是单约束校验的入口，根据约束类型分发到对应的校验函数。
 * 调用方只需要传入约束类型和相关信息，由分发层决定调用哪个校验函数。
 *
 * @param constraintType - 约束类型（'notNull' | 'unique' 等）
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param columnId - 列 ID
 * @param nodes - 图中所有节点的数组
 * @param edges - 图中所有边的数组
 * @param updateNodeData - 更新节点数据的回调函数
 *
 * @example
 * ```typescript
 * // 在 NodeCanvas 中调用
 * dispatchValidation('notNull', 'schema-1', 'col-1', nodes, edges, updateNodeData);
 * dispatchValidation('unique', 'schema-1', 'col-2', nodes, edges, updateNodeData);
 * ```
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

  const schemaNode = nodes.find((n) => n.id === schemaNodeId && n.type === 'schema')
  if (!schemaNode) {
    logger.warn(`❌ 未找到 SchemaNode: ${schemaNodeId}`)
    return
  }

  const schemaData = schemaNode.data as SchemaNodeData
  const column = schemaData.columns.find((col: any) => col.id === columnId)

  if (!column) {
    logger.warn(`❌ 未找到列: ${columnId}`)
    return
  }

  try {
    const result = await validateConstraint(constraintType, columnId, column.columnName, sourceInfo)
    applySingleValidationResult(schemaNodeId, columnId, result, nodes, updateNodeData)
  } catch (error) {
    logger.error(`❌ ${constraintType} 校验异常:`, error)
    throw error
  }
}

/**
 * 将单个校验结果应用到 SchemaNode
 *
 * 内部辅助函数，将单个校验结果更新到 SchemaNode 的列数据中。
 * 支持智能合并：保留其他约束类型的错误，只更新当前约束类型相关的错误。
 *
 * @param schemaNodeId - SchemaNode 的节点 ID
 * @param columnId - 列 ID
 * @param result - 校验结果
 * @param nodes - 图中所有节点的数组
 * @param updateNodeData - 更新节点数据的回调函数
 */
function applySingleValidationResult(
  schemaNodeId: string,
  columnId: string,
  result: ValidationResult,
  nodes: Node[],
  updateNodeData: (nodeId: string, data: any) => void
): void {
  const schemaNode = nodes.find((n) => n.id === schemaNodeId && n.type === 'schema')
  if (!schemaNode) return

  const schemaData = schemaNode.data as SchemaNodeData
  const originalColumns = schemaData.columns || []

  const updatedColumns = originalColumns.map((col: any) => {
    if (col.id === columnId) {
      const existingErrors = col.validationErrors || []
      const newErrors = result.errors

      const mergedErrors = mergeValidationErrors(existingErrors, newErrors, result.constraintType)

      return {
        ...col,
        validationErrors: mergedErrors,
      }
    }
    return col
  })

  updateNodeData(schemaNodeId, {
    ...schemaData,
    columns: updatedColumns,
    saveState: 'draft',
    updatedAt: new Date().toISOString(),
  })

  logger.debug(
    `📊 已更新 SchemaNode ${schemaNodeId} 列 ${columnId} 的 ${result.constraintType} 校验结果`
  )
}

/**
 * 合并验证错误信息
 *
 * 根据约束类型智能合并错误信息，保留其他约束类型的错误，
 * 只更新当前约束类型相关的错误。
 *
 * @param existingErrors - 现有的错误消息数组
 * @param newErrors - 新的错误消息数组
 * @param constraintType - 约束类型（'notNull' | 'unique'）
 * @returns 合并后的错误消息数组
 */
function mergeValidationErrors(
  existingErrors: string[],
  newErrors: string[],
  constraintType: string
): string[] {
  const errorTypeMap: Record<string, string> = {
    notNull: '为空',
    unique: '重复',
  }

  const targetKeyword = errorTypeMap[constraintType]
  if (!targetKeyword) {
    return newErrors
  }

  const otherErrors = existingErrors.filter((err) => !err.includes(targetKeyword))

  return [...otherErrors, ...newErrors]
}

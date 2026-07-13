/**
 * @file executors.ts
 * @description 约束校验执行（Layer 1：纯执行）
 *
 * 本层职责：构建校验上下文、查找 handler、调用 handler.validate 得到结果。
 * 特征：纯执行，**只返回结果**，不碰渲染副作用——
 * 不调 updateNodeData（节点数据回写），不调 updateEdgeData（边状态/粒子着色）。
 *
 * 这一隔离是本拆分的核心：将"算出校验结果"与"把结果写回节点/边渲染"解耦，
 * 使执行层可独立测试（无需 mock 渲染回调），渲染层集中管理副作用。
 *
 * 依赖方向：→ validationContext（构建 ctx）→ handlerRegistry（查 handler）
 */

import type { Edge, Node } from '@vue-flow/core'

import { logger } from '@/core/utils/logger'

import { getHandlerByNodeType } from '../handlerRegistry'
import { buildValidationContext } from '../validationContext'
import type { ConstraintValidationContext, ConstraintValidationResult } from '../types'

// ============================================================================
// 边驱动执行（Schema → Constraint）
// ============================================================================

/**
 * 执行单个 handler 校验（Schema + edge 驱动）的纯执行部分
 *
 * 构建 ctx → 查 handler → 调 validate → 返回 { result, columnId }。
 * 不写节点数据，不写边状态——由调用方（syncStrategies + 胶水层）负责回写。
 *
 * @returns 校验结果 + 列 ID；ctx 构建失败或无 handler 时返回 null
 */
export async function executeHandlerForEdge(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
}): Promise<{ result: ConstraintValidationResult; columnId: string; columnName: string } | null> {
  const { schemaNode, constraintNode, edge, nodes } = params
  const ctx = buildValidationContext({ schemaNode, constraintNode, edge, nodes })
  if (!ctx) return null
  const handler = getHandlerByNodeType(constraintNode.type)
  if (!handler) return null

  const result = await handler.validate(ctx)
  return { result, columnId: ctx.columnId, columnName: ctx.columnName }
}

// ============================================================================
// Inline 执行（ManualData / TransformOutput → Constraint）
// ============================================================================

/**
 * 为纯数据节点（TransformOutput / ManualData）构建校验上下文并执行
 *
 * 与 executeHandlerForEdge 的区别：inline 源无 edge，直接从节点 rows 提取数据。
 * 列名优先取约束节点指定的 inputColumn/column，否则回退数据源 columnName。
 *
 * @returns 校验结果 + 列名；源节点不存在或无 handler 时返回 null
 */
export async function executeHandlerForInline(params: {
  sourceNodeId: string
  constraintNode: Node
  nodes: Node[]
}): Promise<{ result: ConstraintValidationResult; columnName: string } | null> {
  const { sourceNodeId, constraintNode, nodes } = params

  const sourceNode = nodes.find((n) => n.id === sourceNodeId)
  if (!sourceNode) {
    logger.warn('❌ 未找到源节点:', sourceNodeId)
    return null
  }

  // 从 TransformOutput / ManualData 节点提取行数据
  const sourceData = sourceNode.data as Record<string, unknown>
  const rawRows = (sourceData.rows as string[][]) || []
  const sourceColumnName = (sourceData.columnName as string) || 'Column1'

  // 约束节点自身可能指定了目标列（例如模板展开的参数），优先使用；
  // 否则回退到数据源节点的列名。
  const constraintData = (constraintNode.data || {}) as Record<string, unknown>
  const columnName =
    (constraintData.inputColumn as string) || (constraintData.column as string) || sourceColumnName

  const handler = getHandlerByNodeType(constraintNode.type)
  if (!handler) {
    logger.debug('ℹ️ 未找到约束处理器:', constraintNode.type)
    return null
  }

  // 后端 inline 校验默认将 rows 第一行视为表头；
  // 但 TransformOutput / ManualData 的 rows 均为纯数据行（不含表头）。
  // 通过 column_names 显式指定列名，使后端将 rows 全部视为数据行。
  const inlineColumnNames = [columnName]

  const ctx: ConstraintValidationContext = {
    nodes,
    schemaNode: sourceNode,
    constraintNode,
    edge: {} as Edge,
    columnId: '0',
    columnName,
    columnDataType: (sourceData.columnDataType as string) || undefined,
    inlineRows: rawRows,
    inlineColumnNames,
  }

  const result = await handler.validate(ctx)
  return { result, columnName }
}

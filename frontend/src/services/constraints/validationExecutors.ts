/**
 * @file validationExecutors.ts
 * @description 约束校验执行入口（胶水层：组合 executor + sync）
 *
 * 本模块是约束校验的"怎么做"层。原为 462 行单体文件，已拆分为三层子模块，
 * 此文件作为胶水层，组合 Layer 1（纯执行）+ Layer 2（渲染同步）为公共入口，
 * 并 re-export Layer 0（纯聚合）的符号。
 *
 * 三层结构（见 validationExecutors/ 子目录）：
 * - pureAggregators.ts (Layer 0)：列错误聚合 + 断连重置（纯逻辑，无执行无渲染）
 * - executors.ts       (Layer 1)：构建 ctx + 调 handler.validate（只返回结果）
 * - syncStrategies.ts  (Layer 2)：写回节点/边渲染（收敛 updateEdgeData）
 *
 * 本文件（胶水层）职责：组合执行+同步为 4 条公共校验路径：
 * - E: validateConstraintNode — 单约束校验（Schema + edge 驱动）
 * - F: validateConstraintNodesForSchema — 全 Schema 关联约束批量校验
 * - G: validateForInlineSource / validateConstraintNodeById — inline / 按 ID 校验
 *
 * barrel 契约：validationRegistryCore.ts 的 `export *` 透传本文件的 8 个导出，
 * 50+ 调用方零改动。
 *
 * 依赖方向：→ 三层子模块 → handlerRegistry/validationContext/vueFlowApi
 */

import type { Edge, Node } from '@vue-flow/core'

import { validateRegexNodesForSchema } from '@/services/regex/regexValidationHandler'

import { isConstraintNodeType } from './constraintMeta'
import {
  rebuildAllColumnErrors,
  syncColumnErrorsForSourceRef,
  resetDownstreamValidationStatus,
  buildColumnErrorMap,
} from './validationExecutors/pureAggregators'
import { executeHandlerForEdge, executeHandlerForInline } from './validationExecutors/executors'
import {
  syncConstraintNodeResult,
  syncInlineConstraintNodeResult,
  syncEdgeStatus,
} from './validationExecutors/syncStrategies'

// ============================================================================
// 公共子函数：执行 handler 并同步节点/边状态（胶水：Layer 1 + Layer 2）
// ============================================================================

/**
 * 执行单个 handler 校验并同步状态到节点 + 边
 *
 * E（单节点校验）和 F（全表批量校验）的公共逻辑。
 * 组合 Layer 1（executeHandlerForEdge）+ Layer 2（syncConstraintNodeResult + syncEdgeStatus）。
 * 返回校验结果供调用方收集统计信息。
 */
async function _executeAndSync(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<{ result: import('./types').ConstraintValidationResult; columnId: string } | null> {
  const { schemaNode, constraintNode, edge, nodes, updateNodeData } = params

  // Layer 1：纯执行，返回 { result, columnId, columnName } | null
  const output = await executeHandlerForEdge({
    schemaNode,
    constraintNode,
    edge,
    nodes,
  })
  if (!output) return null

  const { result, columnId, columnName } = output

  // Layer 2：渲染同步（写回节点数据 + 边状态）
  syncConstraintNodeResult({
    constraintNode,
    schemaNode,
    columnId,
    columnName,
    result,
    updateNodeData,
  })
  syncEdgeStatus(edge, result.status)

  return { result, columnId }
}

// ============================================================================
// E: 单约束校验入口
// ============================================================================

/**
 * 验证单个约束节点（Schema + edge 驱动）
 *
 * 由 globalValidation.ts 的 dispatchValidation 调用，
 * 用于约束连接建立后的即时单约束校验。
 */
export async function validateConstraintNode(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<void> {
  await _executeAndSync(params)
}

// ============================================================================
// F: 全 Schema 批量校验入口
// ============================================================================

export interface ValidationSummary {
  totalConstraints: number
  validConstraints: number
  invalidConstraints: number
  totalErrors: number
}

/**
 * 验证 Schema 节点关联的所有约束（批量）
 *
 * 由 globalValidation.ts 的全表校验和 useSourcePreviewEvents.ts 调用。
 * 先校验非 Composite 约束，再校验 Composite 约束（依赖子约束结果）。
 * 同时合并 Regex 节点校验结果，并将列级错误同步到 Schema 节点。
 */
export async function validateConstraintNodesForSchema(params: {
  schemaNodeId: string
  nodes: Node[]
  edges: Edge[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<ValidationSummary> {
  const { schemaNodeId, nodes, edges, updateNodeData } = params
  const emptySummary: ValidationSummary = {
    totalConstraints: 0,
    validConstraints: 0,
    invalidConstraints: 0,
    totalErrors: 0,
  }

  const schemaNode = nodes.find(
    (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
  )
  if (!schemaNode) return emptySummary
  const schemaEdges = edges.filter((e) => e.source === schemaNodeId)

  const nonCompositeEdges = schemaEdges.filter((e) => {
    const node = nodes.find((n) => n.id === e.target)
    return node?.type !== 'compositeConstraint'
  })

  const compositeEdges = schemaEdges.filter((e) => {
    const node = nodes.find((n) => n.id === e.target)
    return node?.type === 'compositeConstraint'
  })

  if (nonCompositeEdges.length === 0 && compositeEdges.length === 0) return emptySummary

  const columnErrorMap = new Map<string, string[]>()
  let totalValid = 0
  let totalInvalid = 0
  let totalErrorCount = 0
  // Bug 3.3 修复：按实际处理的约束数统计 totalConstraints，
  // 避免 idle/missing 状态被遗漏（原 totalValid + totalInvalid 口径会少计）
  let totalProcessed = 0

  const validateEdgeBatch = async (edgeList: Edge[]) => {
    for (const edge of edgeList) {
      const constraintNode = nodes.find((n) => n.id === edge.target)
      if (!constraintNode || !isConstraintNodeType(constraintNode.type)) continue

      const output = await _executeAndSync({
        schemaNode,
        constraintNode,
        edge,
        nodes,
        updateNodeData,
      })
      if (!output) continue

      // 只要 handler 执行并返回了结果，即视为已处理的约束（含 pass/error/idle/missing）
      totalProcessed++

      const { result, columnId } = output

      if (result.status === 'pass') {
        totalValid++
      } else if (result.status === 'error') {
        totalInvalid++
        totalErrorCount += result.lastValidation?.errorCount || result.validationErrors.length
      }

      if (result.validationErrors.length > 0) {
        const existing = columnErrorMap.get(columnId) || []
        columnErrorMap.set(columnId, [...existing, ...result.validationErrors])
      }
    }
  }

  await validateEdgeBatch(nonCompositeEdges)
  await validateEdgeBatch(compositeEdges)

  // ====================================================================
  // Regex 节点校验（edge-driven）
  // ====================================================================
  const regexSummary = await validateRegexNodesForSchema({
    schemaNode,
    schemaEdges,
    nodes,
    edges,
    updateNodeData,
  })
  if (regexSummary) {
    totalValid += regexSummary.totalValid
    totalInvalid += regexSummary.totalInvalid
    totalErrorCount += regexSummary.totalErrorCount
    // Regex 节点的校验总数也计入 totalProcessed（regex 无 idle 状态，valid+invalid 即总数）
    totalProcessed += regexSummary.totalValid + regexSummary.totalInvalid
    for (const [colId, errors] of regexSummary.columnErrorMap.entries()) {
      const existing = columnErrorMap.get(colId) || []
      columnErrorMap.set(colId, [...existing, ...errors])
    }
  }

  const schemaData = (schemaNode.data || {}) as Record<string, unknown>
  const columns = (schemaData.columns || []) as Array<Record<string, unknown>>
  if (columns.length > 0) {
    const updatedColumns = columns.map((col) => {
      const colId = col.id as string
      const errors = columnErrorMap.get(colId) || []
      return {
        ...col,
        validationErrors: errors,
      }
    })
    updateNodeData(schemaNodeId, {
      ...schemaData,
      columns: updatedColumns,
    })
  }

  return {
    totalConstraints: totalProcessed,
    validConstraints: totalValid,
    invalidConstraints: totalInvalid,
    totalErrors: totalErrorCount,
  }
}

// ============================================================================
// G: inline / by-id 校验入口
// ============================================================================

/**
 * 为纯数据节点（TransformOutput / ManualData）触发约束校验
 *
 * 这些节点的数据（rows: string[][]）已在前端内存中，
 * 无需后端文件路径，通过 inlineRows 传递给约束处理器进行本地校验。
 */
export async function validateForInlineSource(params: {
  sourceNodeId: string
  constraintNode: Node
  nodes: Node[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<void> {
  const { sourceNodeId, constraintNode, nodes, updateNodeData } = params

  // Layer 1：纯执行
  const output = await executeHandlerForInline({ sourceNodeId, constraintNode, nodes })
  if (!output) return

  const { result, columnName } = output

  // Layer 2：渲染同步（inline 版，sourceRef columnId 固定为 '0'）
  const sourceNode = nodes.find((n) => n.id === sourceNodeId)!
  syncInlineConstraintNodeResult({
    constraintNode,
    sourceNode,
    columnName,
    result,
    updateNodeData,
  })
}

/**
 * 通过约束节点 ID 执行单约束校验（统一入口）
 *
 * 自动检测数据源类型（Schema 或 inline），查找对应的 edge 和源节点，
 * 调用合适的校验路径并更新节点数据。
 * 被 7 个约束节点组件（*ConstraintNode.vue）在编辑后调用。
 */
export async function validateConstraintNodeById(
  constraintNodeId: string,
  nodes: Node[],
  edges: Edge[],
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
): Promise<void> {
  const constraintNode = nodes.find((n) => n.id === constraintNodeId)
  if (!constraintNode) return

  const nodeData = (constraintNode.data || {}) as Record<string, unknown>
  const sourceRef = nodeData.sourceRef as { nodeId: string; columnId: string } | undefined

  if (!sourceRef?.nodeId) return

  const sourceNode = nodes.find((n) => n.id === sourceRef.nodeId)
  if (!sourceNode) return

  if (sourceNode.type === 'manualData' || sourceNode.type === 'transformOutput') {
    await validateForInlineSource({
      sourceNodeId: sourceRef.nodeId,
      constraintNode,
      nodes,
      updateNodeData,
    })
    return
  }

  if (sourceNode.type === 'schema' || sourceNode.type === 'jsonSchema') {
    const edge = edges.find((e) => e.target === constraintNodeId && e.source === sourceRef.nodeId)
    if (!edge) return

    await validateConstraintNode({
      schemaNode: sourceNode,
      constraintNode,
      edge,
      nodes,
      updateNodeData,
    })

    // Bug 3.4 修复：单约束校验后全列重建错误，避免其他列残留 stale 错误
    // （原 syncColumnErrorsForSourceRef 仅刷当前列，约束 sourceRef 变更后旧列错误不会被清除）
    rebuildAllColumnErrors(sourceRef.nodeId, nodes, updateNodeData)
  }
}

// ============================================================================
// re-export Layer 0 纯聚合函数（保持 barrel 契约：8 函数导出不变）
// ============================================================================

export { rebuildAllColumnErrors, syncColumnErrorsForSourceRef, resetDownstreamValidationStatus }
// buildColumnErrorMap 为内部提取的复用函数，暂不纳入公共 barrel（无外部调用方）
export { buildColumnErrorMap }

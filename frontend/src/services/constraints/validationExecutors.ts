/**
 * @file validationExecutors.ts
 * @description 约束校验执行入口
 *
 * 本模块是约束校验的"怎么做"层：提供三条校验执行路径
 * + 一条列错误同步路径。
 *
 * 三条校验入口：
 * - E: validateConstraintNode — 单约束校验（Schema + edge 驱动）
 * - F: validateConstraintNodesForSchema — 全 Schema 关联约束批量校验
 * - G: validateForInlineSource / validateConstraintNodeById — inline 数据源 / 按 ID 校验
 *
 * 依赖方向：→ handlerRegistry（查 handler）→ constraintMeta（类型判断）
 */

import type { Edge, Node } from '@vue-flow/core'

import { logger } from '@/core/utils/logger'
import { updateEdgeData } from '@/services/canvas/vueFlowApi'
import { validateRegexNodesForSchema } from '@/services/regex/regexValidationHandler'

import { isConstraintNodeType } from './constraintMeta'
import { getHandlerByNodeType } from './handlerRegistry'
import { buildDisconnectReset } from './disconnectAndSync'
import { buildValidationContext } from './validationContext'
import type { ConstraintValidationContext, ConstraintValidationResult } from './types'

// ============================================================================
// 公共子函数：执行 handler 并同步节点/边状态
// ============================================================================

/**
 * 执行单个 handler 校验并同步状态到节点 + 边
 *
 * E（单节点校验）和 F（全表批量校验）的公共逻辑，消除重复代码。
 * 返回校验结果供调用方收集统计信息。
 */
async function _executeAndSync(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}): Promise<{ result: ConstraintValidationResult; columnId: string } | null> {
  const { schemaNode, constraintNode, edge, nodes, updateNodeData } = params
  const ctx = buildValidationContext({ schemaNode, constraintNode, edge, nodes })
  if (!ctx) return null
  const handler = getHandlerByNodeType(constraintNode.type)
  if (!handler) return null

  const result = await handler.validate(ctx)

  updateNodeData(constraintNode.id, {
    table: ((schemaNode.data || {}) as Record<string, unknown>)?.tableName as string,
    column: ctx.columnName,
    sourceRef: { nodeId: schemaNode.id, columnId: ctx.columnId },
    validationStatus: result.status,
    validationErrors: result.validationErrors,
    lastValidation: result.lastValidation,
  })
  // 同步校验状态到边，驱动粒子着色
  updateEdgeData(edge.id, { validationStatus: result.status })

  return { result, columnId: ctx.columnId }
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
 * 重置 Schema 下游所有约束节点的校验状态（不重置 sourceRef/table/column 等结构映射）
 *
 * 在 Schema 失去数据源（无入边、路径不可达）时调用，
 * 清除残留的 pass/error 校验结果，避免"幽灵校验结果"（Bug 2.2）。
 * 注意：正常断连由 dataSourceToSchema 断连 handler 处理，此处为防御性兜底。
 */
export function resetDownstreamValidationStatus(
  schemaNodeId: string,
  nodes: Node[],
  edges: Edge[],
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
): void {
  const schemaEdges = edges.filter((e) => e.source === schemaNodeId)
  for (const ce of schemaEdges) {
    const constraintNode = nodes.find((n) => n.id === ce.target)
    if (!constraintNode || !isConstraintNodeType(constraintNode.type)) continue
    const data = (constraintNode.data || {}) as Record<string, unknown>
    updateNodeData(constraintNode.id, {
      ...buildDisconnectReset(constraintNode.type, data),
    })
  }
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

  const sourceNode = nodes.find((n) => n.id === sourceNodeId)
  if (!sourceNode) {
    logger.warn('❌ 未找到源节点:', sourceNodeId)
    return
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
    return
  }

  // 后端 inline 校验默认将 rows 第一行视为表头；
  // 但 TransformOutput / ManualData 的 rows 均为纯数据行（不含表头）。
  // 通过 column_names 显式指定列名，使后端将 rows 全部视为数据行。
  const inlineColumnNames = [columnName]

  // 构建带有 inlineRows 的校验上下文
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

  updateNodeData(constraintNode.id, {
    table: (sourceData.configName as string) || columnName,
    column: columnName,
    sourceRef: { nodeId: sourceNode.id, columnId: '0' },
    validationStatus: result.status,
    validationErrors: result.validationErrors,
    lastValidation: result.lastValidation,
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
// 列错误同步
// ============================================================================

/**
 * 将指定 Schema 列关联的所有约束错误汇总写入该列的 validationErrors
 *
 * 被 validateConstraintNodeById 在单约束校验后调用，
 * 确保列级错误展示与约束校验结果同步。
 */
export function syncColumnErrorsForSourceRef(
  schemaNodeId: string,
  columnId: string,
  nodes: Node[],
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
): void {
  const schemaNode = nodes.find((n) => n.id === schemaNodeId)
  if (!schemaNode) return
  const schemaData = (schemaNode.data || {}) as Record<string, unknown>
  const columns = (schemaData.columns || []) as Array<Record<string, unknown>>
  if (columns.length === 0) return

  const columnErrors: string[] = []
  for (const node of nodes) {
    if (!isConstraintNodeType(node.type)) continue
    const nd = (node.data || {}) as Record<string, unknown>
    const ref = nd.sourceRef as { nodeId: string; columnId: string } | undefined
    if (ref?.nodeId === schemaNodeId && ref?.columnId === columnId) {
      const errors = (nd.validationErrors as string[]) || []
      columnErrors.push(...errors)
    }
  }

  const updatedColumns = columns.map((col) => {
    if ((col as Record<string, unknown>).id === columnId) {
      return { ...col, validationErrors: columnErrors }
    }
    return col
  })
  updateNodeData(schemaNodeId, {
    ...schemaData,
    columns: updatedColumns,
  })
}

/**
 * 重建 Schema 所有列的 validationErrors（全列扫描）
 *
 * 与 syncColumnErrorsForSourceRef（仅刷当前列）的区别：
 * 此函数扫描 Schema 下所有约束节点的 sourceRef，为每一列重新汇总错误，
 * 确保某约束的 sourceRef 变更后，旧列的 stale 错误也能被清除（Bug 3.4）。
 * 批量路径 validateConstraintNodesForSchema 与此逻辑等价（经 columnErrorMap）。
 */
export function rebuildAllColumnErrors(
  schemaNodeId: string,
  nodes: Node[],
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
): void {
  const schemaNode = nodes.find((n) => n.id === schemaNodeId)
  if (!schemaNode) return
  const schemaData = (schemaNode.data || {}) as Record<string, unknown>
  const columns = (schemaData.columns || []) as Array<Record<string, unknown>>
  if (columns.length === 0) return

  // 按列 ID 汇总所有引用本 Schema 的约束节点的错误
  const columnErrorMap = new Map<string, string[]>()
  for (const node of nodes) {
    if (!isConstraintNodeType(node.type)) continue
    const nd = (node.data || {}) as Record<string, unknown>
    const ref = nd.sourceRef as { nodeId: string; columnId: string } | undefined
    if (ref?.nodeId === schemaNodeId && ref.columnId) {
      const errors = (nd.validationErrors as string[]) || []
      if (errors.length > 0) {
        const existing = columnErrorMap.get(ref.columnId) || []
        columnErrorMap.set(ref.columnId, [...existing, ...errors])
      }
    }
  }

  const updatedColumns = columns.map((col) => {
    const colId = col.id as string
    return { ...col, validationErrors: columnErrorMap.get(colId) || [] }
  })
  updateNodeData(schemaNodeId, {
    ...schemaData,
    columns: updatedColumns,
  })
}

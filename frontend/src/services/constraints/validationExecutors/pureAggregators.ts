/**
 * @file pureAggregators.ts
 * @description 列错误聚合与断连重置（Layer 0：纯聚合）
 *
 * 本层职责：扫描节点/边数据，聚合约束错误到 Schema 列，或重置下游校验状态。
 * 特征：纯逻辑，无校验执行（不调 handler.validate），无渲染副作用
 * （不调 updateNodeData/updateEdgeData — 仅通过传入的 updateNodeData 回调写回）。
 *
 * 依赖方向：→ constraintMeta（类型判断）→ disconnectAndSync（断连重置构建）
 */

import type { Edge, Node } from '@vue-flow/core'

import { isConstraintNodeType } from '../constraintMeta'
import { buildDisconnectReset } from '../disconnectAndSync'

// ============================================================================
// 列错误聚合
// ============================================================================

/**
 * 按列 ID 汇总所有引用指定 Schema 的约束节点的错误
 *
 * 纯聚合函数：遍历节点，收集 sourceRef 匹配的约束错误，返回 columnId → errors 映射。
 * 被 rebuildAllColumnErrors 和批量校验路径（validateConstraintNodesForSchema）复用。
 */
export function buildColumnErrorMap(schemaNodeId: string, nodes: Node[]): Map<string, string[]> {
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
  return columnErrorMap
}

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

  const columnErrorMap = buildColumnErrorMap(schemaNodeId, nodes)

  const updatedColumns = columns.map((col) => {
    const colId = col.id as string
    return { ...col, validationErrors: columnErrorMap.get(colId) || [] }
  })
  updateNodeData(schemaNodeId, {
    ...schemaData,
    columns: updatedColumns,
  })
}

// ============================================================================
// 断连重置
// ============================================================================

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

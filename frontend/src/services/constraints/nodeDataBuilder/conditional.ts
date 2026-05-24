/**
 * @fileoverview Conditional builder — IF/THEN 多端口处理
 *
 * Conditional 约束有 IF 条件（可多个）和 THEN 列，
 * 需要创建 THEN 约束边 + 每个有列引用的 IF 条件各一条 IF 边。
 */

import type { BuildInput, BuildResult } from './types'
import { registerBuilder } from './registry'

function buildConditional(input: BuildInput): BuildResult {
  const {
    tableName,
    configName,
    nodeId,
    mode,
    saveState,
    embedded,
    ifConditions,
    ifLogic,
    thenRef,
    thenConditionConfig,
    columnRef,
  } = input

  const resolvedIfLogic = ifLogic || 'and'

  // 构建 ifConditions 数组（带 ref 和 column）
  const resolvedConditions = (ifConditions || []).map((cond) => ({
    operator: cond.operator,
    value: cond.value,
    ...(cond.values !== undefined ? { values: cond.values } : {}),
    ref: cond.columnId
      ? { nodeId: input.schemaNodeId, columnId: cond.columnId }
      : undefined,
    column: cond.columnName,
  }))

  const firstIf = resolvedConditions.find((c) => c.ref?.columnId)

  const nodeData: Record<string, unknown> = {
    configName,
    table: tableName,
    ifColumn: firstIf?.column || '',
    ifValue: typeof firstIf?.value === 'string' ? firstIf.value : '',
    thenColumn: thenRef?.columnName || '',
    thenConditionConfig,
    ifLogic: resolvedIfLogic,
    ifConditions: resolvedConditions,
    ifRef: firstIf?.ref,
    thenRef: thenRef || undefined,
    validationStatus: 'idle',
    validationErrors: [],
    saveState: saveState || (mode === 'connect' ? 'draft' : 'saved'),
  }

  if (embedded) {
    nodeData.embedded = true
  }

  const edgeDescriptors = []

  // THEN 约束边
  if (thenRef?.columnId) {
    edgeDescriptors.push({
      kind: 'constraint' as const,
      sourceNodeId: input.schemaNodeId,
      targetNodeId: nodeId,
      columnId: thenRef.columnId,
    })
  }

  // IF 条件边（每个有列引用的条件创建一条边）
  for (const cond of resolvedConditions) {
    if (cond.ref?.columnId) {
      edgeDescriptors.push({
        kind: 'if' as const,
        sourceNodeId: input.schemaNodeId,
        targetNodeId: nodeId,
        columnId: cond.ref.columnId,
        targetHandle: `target-if-${nodeId}`,
      })
    }
  }

  return { nodeData, edgeDescriptors }
}

registerBuilder('conditional', buildConditional)

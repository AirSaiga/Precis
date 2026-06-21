/**
 * @fileoverview Embedded Constraint Builder
 *
 * 将约束节点转换为 ConstraintItemV2（用于嵌入 schema.yaml）。
 * 与 standalone ConstraintFileV2 不同，ConstraintItemV2 没有 refs 字段，
 * 引用直接在顶层通过 column / from_table / to_table 等字段表达。
 */

import type { ConditionalConstraintNodeData, CustomNode } from '@/types/graph'
import type { ConstraintItemV2, ConstraintTypeV2 } from '@/types/projectV2'
import { getV2ConstraintTypeByNodeType } from '@/services/constraints/validationRegistry'

/**
 * Composite 约束不能嵌入 schema，直接抛出错误。
 */
export class CompositeCannotEmbedError extends Error {
  constructor(nodeId: string) {
    super(`Composite 约束 ${nodeId} 不能嵌入 schema 文件，请使用独立保存`)
    this.name = 'CompositeCannotEmbedError'
  }
}

/**
 * 构建内嵌约束项
 */
export function buildEmbeddedConstraintItem(node: CustomNode): ConstraintItemV2 {
  const v2Type = getV2ConstraintTypeByNodeType(node.type)
  if (!v2Type) {
    throw new Error(`未知约束类型: ${node.type}`)
  }

  if (v2Type === 'Composite') {
    throw new CompositeCannotEmbedError(node.id)
  }

  const d = (node.data || {}) as Record<string, unknown>
  const base: ConstraintItemV2 = {
    id: node.id,
    type: v2Type as ConstraintTypeV2,
    enabled: d.enabled !== false,
    description: (d.configName as string) || undefined,
  }

  switch (v2Type) {
    case 'NotNull':
    case 'Unique':
    case 'AllowedValues':
    case 'Range':
    case 'Charset':
    case 'DateLogic':
    case 'Scripted': {
      const column = d.column as string
      if (column) base.column = column
      base.params = buildParamsForType(v2Type, d)
      break
    }

    case 'ForeignKey': {
      base.from_table = d.sourceTable as string
      base.from_column = d.sourceColumn as string
      base.to_table = d.targetTable as string
      base.to_column = d.targetColumn as string
      base.params = {}
      break
    }

    case 'Conditional': {
      const cd = d as unknown as ConditionalConstraintNodeData
      const thenColumnId = cd.thenRef?.columnId || cd.thenColumn
      if (thenColumnId) base.column = thenColumnId

      const params: Record<string, unknown> = {
        then_condition: cd.thenConditionConfig,
      }

      if (cd.ifLogic) params.if_logic = cd.ifLogic
      const ifConditions = cd.ifConditions || []
      if (ifConditions.length > 0) {
        const validConditions = ifConditions
          .filter((c) => {
            if (!c.operator) {
              console.warn(
                `[EmbeddedConstraintBuilder] Conditional ${node.id}: 跳过缺少 operator 的条件`
              )
              return false
            }
            return true
          })
          .map((c) => ({
            if_column_id: c.ref?.columnId || cd.ifRef?.columnId || c.column || '',
            operator: c.operator,
            value: c.value,
            values: c.values,
          }))
          .filter((c) => {
            if (!c.if_column_id) {
              console.warn(
                `[EmbeddedConstraintBuilder] Conditional ${node.id}: 跳过缺少 if_column_id 的条件 (operator=${c.operator})`
              )
              return false
            }
            return true
          })

        if (validConditions.length < ifConditions.length) {
          console.warn(
            `[EmbeddedConstraintBuilder] Conditional ${node.id}: ${ifConditions.length - validConditions.length} 个条件被丢弃，仅保留 ${validConditions.length} 个有效条件`
          )
        }

        params.if_conditions = validConditions
      }

      base.params = params
      break
    }
  }

  return base
}

function buildParamsForType(v2Type: string, d: Record<string, unknown>): Record<string, unknown> {
  switch (v2Type) {
    case 'AllowedValues':
      return {
        allowed_values: Array.from((d.allowedValues as unknown[]) || []).map((v) => String(v)),
      }
    case 'Range': {
      const params: Record<string, unknown> = {}
      if (d.minValue !== undefined) params.min = d.minValue
      if (d.maxValue !== undefined) params.max = d.maxValue
      params.boundary_mode = d.boundaryMode || 'inclusive'
      return params
    }
    case 'Charset': {
      const params: Record<string, unknown> = {
        charset_mode: d.charsetMode || 'ascii',
      }
      if (d.allowedChars) params.allowed_chars = d.allowedChars
      if (d.disallowedChars) params.disallowed_chars = d.disallowedChars
      return params
    }
    case 'Scripted':
      return {
        name: d.constraintName || d.configName || '',
        expression: d.script || '',
      }
    case 'DateLogic': {
      const params: Record<string, unknown> = {
        logic_mode: (d.logicMode as string) || 'compare',
      }
      if (d.logicMode === 'compare') {
        params.compare_op = (d.compareOp as string) || 'gt'
        if (d.compareOp === 'range') {
          if (d.referenceDate) params.reference_date = d.referenceDate
          if (d.referenceColumn) params.reference_column = d.referenceColumn
          if (d.referenceDateEnd) params.reference_date_end = d.referenceDateEnd
          if (d.referenceColumnEnd) params.reference_column_end = d.referenceColumnEnd
        } else {
          if (d.referenceDate) params.reference_date = d.referenceDate
          if (d.referenceColumn) params.reference_column = d.referenceColumn
        }
      } else {
        params.calculation_type = (d.calculationType as string) || 'age'
        if (d.targetValue) params.target_value = d.targetValue
        if (d.targetColumn) params.target_column = d.targetColumn
      }
      return params
    }
    default:
      return {}
  }
}

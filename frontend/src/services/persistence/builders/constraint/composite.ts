/**
 * @fileoverview Composite Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs } from './helpers'

/**
 * 根据子约束节点数据构建 params
 */
function buildSubConstraintParams(subData: Record<string, unknown>): Record<string, unknown> {
  const subType = (subData.type as string) || ''

  switch (subType) {
    case 'Range':
      return {
        min: subData.minValue,
        max: subData.maxValue,
        boundary_mode: subData.boundaryMode || 'inclusive',
      }
    case 'Charset':
      return {
        charset_mode: subData.charsetMode || 'custom',
        allowed_chars: subData.allowedChars,
        disallowed_chars: subData.disallowedChars,
      }
    case 'AllowedValues':
      return {
        allowed_values: Array.from((subData.allowedValues as unknown[]) || []).map((v) =>
          String(v)
        ),
      }
    case 'Scripted':
      return {
        name: subData.constraintName || subData.configName || '',
        expression: subData.script || '',
      }
    case 'DateLogic': {
      const params: Record<string, unknown> = {
        logic_mode: subData.logicMode || 'compare',
        compare_op: subData.compareOp,
      }
      if (subData.compareOp === 'range') {
        params.reference_date = subData.referenceDate
        params.reference_column = subData.referenceColumn
        params.reference_date_end = subData.referenceDateEnd
        params.reference_column_end = subData.referenceColumnEnd
      } else {
        params.reference_date = subData.referenceDate
        params.reference_column = subData.referenceColumn
      }
      params.calculation_type = subData.calculationType
      params.target_value = subData.targetValue
      params.target_column = subData.targetColumn
      return params
    }
    case 'Conditional':
      return {
        then_condition: subData.thenConditionConfig,
      }
    default:
      return {}
  }
}

export const compositeBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'compositeConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): {
    consumed: boolean
    file: ConstraintFileV2
  } {
    const d = (node.data || {}) as Record<string, unknown>
    const includedNodeIds = (d.includedNodeIds as string[]) || []

    const subConstraints = includedNodeIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter(
        (n): n is CustomNode => !!n && typeof n.type === 'string' && n.type.endsWith('Constraint')
      )
      .map((subNode) => {
        const subData = (subNode.data || {}) as Record<string, unknown>
        const subType = subNode.type!.replace('Constraint', '')
        return {
          id: subNode.id,
          type: subType.charAt(0).toUpperCase() + subType.slice(1),
          enabled: subData.enabled !== false,
          description:
            (subData.configName as string) || (subData.description as string) || undefined,
          refs: buildSingleColumnRefs(subData, nodes, schemaIdByNodeId),
          params: buildSubConstraintParams(subData),
        }
      })

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'Composite',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs: buildSingleColumnRefs(d, nodes, schemaIdByNodeId),
        params: {
          logic: d.logic || 'all',
          sub_constraints: subConstraints,
        },
      },
    }
  },
}

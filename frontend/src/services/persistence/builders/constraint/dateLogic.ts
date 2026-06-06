/**
 * @fileoverview DateLogic Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs } from './helpers'

export const dateLogicBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'dateLogicConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): { consumed: boolean; file: ConstraintFileV2 } {
    const d = (node.data || {}) as Record<string, unknown>
    const params: Record<string, unknown> = {
      logic_mode: (d.logicMode as string) || 'compare',
    }

    if (d.logicMode === 'compare') {
      params.compare_op = (d.compareOp as string) || 'gt'
      if (d.referenceDate) params.reference_date = d.referenceDate
      if (d.referenceColumn) params.reference_column = d.referenceColumn
    } else {
      params.calculation_type = (d.calculationType as string) || 'age'
      if (d.targetValue) params.target_value = d.targetValue
      if (d.targetColumn) params.target_column = d.targetColumn
    }

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'DateLogic',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs: buildSingleColumnRefs(d, nodes, schemaIdByNodeId),
        params,
      },
    }
  },
}

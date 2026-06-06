/**
 * @fileoverview Range Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs } from './helpers'

export const rangeBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'rangeConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): { consumed: boolean; file: ConstraintFileV2 } {
    const d = (node.data || {}) as Record<string, unknown>
    const params: Record<string, unknown> = {}

    if (d.minValue !== undefined) params.min = d.minValue
    if (d.maxValue !== undefined) params.max = d.maxValue
    if (d.boundaryMode) params.boundary_mode = d.boundaryMode

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'Range',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs: buildSingleColumnRefs(d, nodes, schemaIdByNodeId),
        params,
      },
    }
  },
}

/**
 * @fileoverview Scripted Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs } from './helpers'

export const scriptedBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'scriptedConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): { consumed: boolean; file: ConstraintFileV2 } {
    const d = (node.data || {}) as Record<string, unknown>

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'Scripted',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs: buildSingleColumnRefs(d, nodes, schemaIdByNodeId),
        params: {
          name: d.constraintName || d.configName || node.id,
          expression: d.script || '',
        },
      },
    }
  },
}

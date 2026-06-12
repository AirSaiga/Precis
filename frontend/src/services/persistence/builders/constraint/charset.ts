/**
 * @fileoverview Charset Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs } from './helpers'

export const charsetBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'charsetConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): {
    consumed: boolean
    file: ConstraintFileV2
  } {
    const d = (node.data || {}) as Record<string, unknown>
    const params: Record<string, unknown> = {
      charset_mode: d.charsetMode || 'ascii',
    }

    if (d.allowedChars) params.allowed_chars = d.allowedChars
    if (d.disallowedChars) params.disallowed_chars = d.disallowedChars

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'Charset',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs: buildSingleColumnRefs(d, nodes, schemaIdByNodeId),
        params,
      },
    }
  },
}

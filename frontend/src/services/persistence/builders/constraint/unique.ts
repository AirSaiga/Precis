/**
 * @fileoverview Unique Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs, getSourceRef, normalizeSchemaId } from './helpers'

export const uniqueBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'uniqueConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): { consumed: boolean; file: ConstraintFileV2 } {
    const d = (node.data || {}) as Record<string, unknown>
    const refs: Record<string, unknown> = {}

    const sourceRef = getSourceRef(d)
    if (sourceRef) {
      refs.table_id = normalizeSchemaId(sourceRef.nodeId, schemaIdByNodeId) || sourceRef.nodeId
      refs.column_ids = [sourceRef.columnId]
    } else {
      const resolved = buildSingleColumnRefs(d, nodes, schemaIdByNodeId)
      if (resolved.table_id) refs.table_id = resolved.table_id
      if (resolved.column_id) refs.column_ids = [resolved.column_id]
    }

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'Unique',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs,
        params: {},
      },
    }
  },
}

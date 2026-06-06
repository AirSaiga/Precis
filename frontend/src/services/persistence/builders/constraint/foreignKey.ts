/**
 * @fileoverview ForeignKey Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { normalizeSchemaId } from './helpers'

export const foreignKeyBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'foreignKeyConstraint',
  build({ node, schemaIdByNodeId }: BuilderContext): { consumed: boolean; file: ConstraintFileV2 } {
    const d = (node.data || {}) as Record<string, unknown>
    const sRef = d.sourceRef as { nodeId?: string; columnId?: string } | undefined
    const tRef = d.targetRef as { nodeId?: string; columnId?: string } | undefined
    const refs: Record<string, unknown> = {}

    if (sRef?.nodeId && sRef?.columnId && tRef?.nodeId && tRef?.columnId) {
      refs.from_table_id = normalizeSchemaId(sRef.nodeId, schemaIdByNodeId) || sRef.nodeId
      refs.from_column_id = sRef.columnId
      refs.to_table_id = normalizeSchemaId(tRef.nodeId, schemaIdByNodeId) || tRef.nodeId
      refs.to_column_id = tRef.columnId
    }

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'ForeignKey',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs,
        params: {},
      },
    }
  },
}

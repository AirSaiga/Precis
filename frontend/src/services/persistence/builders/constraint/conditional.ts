/**
 * @fileoverview Conditional Constraint Builder
 */

import type { ConditionalConstraintNodeData, CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { normalizeSchemaId } from './helpers'

export const conditionalBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'conditionalConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): {
    consumed: boolean
    file: ConstraintFileV2
  } {
    const d = (node.data || {}) as ConditionalConstraintNodeData & { enabled?: boolean }
    const refs: Record<string, unknown> = {}

    const firstCondRef = d.ifConditions?.find((c) => c.ref?.nodeId)?.ref

    const schemaId = String(d.thenRef?.nodeId || d.ifRef?.nodeId || firstCondRef?.nodeId || '')
    if (schemaId) {
      refs.table_id = normalizeSchemaId(schemaId, schemaIdByNodeId) || schemaId

      const schemaNode = nodes.find(
        (n) => n.id === schemaId && (n.type === 'schema' || n.type === 'jsonSchema')
      )
      const schemaData = schemaNode?.data as
        | { columns?: Array<{ id: string; columnName: string }> }
        | undefined

      const resolveColumnIdByName = (colName?: string) =>
        schemaData?.columns?.find((c) => c.columnName === colName)?.id

      const thenColumnId = d.thenRef?.columnId || resolveColumnIdByName(d.thenColumn)
      if (thenColumnId) refs.then_column_id = thenColumnId

      refs.if_logic = d.ifLogic || 'and'

      refs.if_conditions = (d.ifConditions || [])
        .filter((cond) => cond.operator)
        .map((cond) => ({
          if_column_id: String(
            cond.ref?.columnId || d.ifRef?.columnId || resolveColumnIdByName(cond.column) || ''
          ),
          operator: cond.operator,
          value: cond.value,
          values: cond.values,
        }))
        .filter((x) => !!x.if_column_id)
    }

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'Conditional',
        enabled: d.enabled !== false,
        description: d.configName || undefined,
        refs,
        params: {
          then_condition: d.thenConditionConfig,
        },
      },
    }
  },
}

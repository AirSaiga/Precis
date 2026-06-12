/**
 * @fileoverview Conditional Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
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
    const d = (node.data || {}) as Record<string, unknown>
    const refs: Record<string, unknown> = {}

    const thenRef = d.thenRef as { nodeId?: string; columnId?: string } | undefined
    const ifRef = d.ifRef as { nodeId?: string; columnId?: string } | undefined
    const firstCondRef = Array.isArray(d.ifConditions)
      ? (d.ifConditions as any[]).find((c: any) => c?.ref?.nodeId)?.ref
      : undefined

    const schemaId = String(thenRef?.nodeId || ifRef?.nodeId || firstCondRef?.nodeId || '')
    if (schemaId) {
      refs.table_id = normalizeSchemaId(schemaId, schemaIdByNodeId) || schemaId

      const schemaNode = nodes.find(
        (n) => n.id === schemaId && (n.type === 'schema' || n.type === 'jsonSchema')
      )
      const schemaData = schemaNode?.data as
        | { columns?: Array<{ id: string; columnName: string }> }
        | undefined

      const resolveColumnNameById = (colId?: string) =>
        schemaData?.columns?.find((c) => c.id === colId)?.columnName || ''
      const resolveColumnIdByName = (colName?: string) =>
        schemaData?.columns?.find((c) => c.columnName === colName)?.id

      const thenColumnId = thenRef?.columnId || resolveColumnIdByName(d.thenColumn as string)
      if (thenColumnId) refs.then_column_id = thenColumnId

      refs.if_logic = d.ifLogic || 'and'

      const ifConditions = Array.isArray(d.ifConditions) ? (d.ifConditions as any[]) : []
      refs.if_conditions = ifConditions
        .filter((cond: any) => cond?.operator)
        .map((cond: any) => ({
          if_column_id: String(
            cond?.ref?.columnId || ifRef?.columnId || resolveColumnIdByName(cond?.column) || ''
          ),
          operator: cond.operator,
          value: cond.value,
          values: cond.values,
        }))
        .filter((x: any) => !!x.if_column_id)
    }

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'Conditional',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs,
        params: {
          then_condition: d.thenConditionConfig,
        },
      },
    }
  },
}

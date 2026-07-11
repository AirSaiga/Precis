/**
 * @fileoverview RegexExtract Builder
 *
 * 将 regexExtract 节点转换为 RegexNodeFileV2（match_mode='extract'）。
 */

import type { RegexExtractNodeData } from '@/types/graph'
import type { RegexNodeFileV2 } from '@/types/projectV2'
import { normalizeTableId } from '../utils'
import type { BuilderContext, NodeBuilder } from '../types'

export const regexExtractBuilder: NodeBuilder<RegexNodeFileV2> = {
  kind: 'regexExtract',
  matches: (node) => node.type === 'regexExtract',
  build({ node, schemaIdByNodeId, nodes }: BuilderContext): {
    consumed: boolean
    file: RegexNodeFileV2
  } {
    const data = node.data as RegexExtractNodeData
    const usesPattern = data.uses_pattern

    let sourceColumnName: string | undefined
    if (data.sourceRef) {
      const schemaNode = nodes.find(
        (n) => n.id === data.sourceRef!.nodeId && (n.type === 'schema' || n.type === 'jsonSchema')
      )
      if (schemaNode) {
        const columns =
          ((schemaNode.data as unknown as Record<string, unknown>).columns as
            | unknown[]
            | undefined) || []
        const col = columns.find(
          (c) => (c as Record<string, unknown>).id === data.sourceRef!.columnId
        ) as Record<string, unknown> | undefined
        sourceColumnName = col?.columnName as string | undefined
      }
    }

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        name: data.configName || 'RegexExtract',
        description: data.description || undefined,
        pattern: usesPattern ? undefined : data.pattern || '',
        uses_pattern: usesPattern || undefined,
        match_mode: 'extract',
        case_sensitive: !!data.caseSensitive,
        flags: data.flags || '',
        enabled: data.enabled !== false,
        parameters: data.parameters || [],
        rules: data.rules || [],
        capture_groups: (data.captureGroups || []).map((g) => ({
          name: g.name,
          group_index: g.groupIndex,
        })),
        output_columns: data.outputColumns || [],
        input_from_node: data.inputFromNode || undefined,
        input_column: data.inputColumn || undefined,
        source_ref: data.sourceRef
          ? {
              table_id:
                normalizeTableId(data.sourceRef.nodeId, schemaIdByNodeId) || data.sourceRef.nodeId,
              column_id: data.sourceRef.columnId,
            }
          : undefined,
        source_column_name: sourceColumnName,
      },
    }
  },
}

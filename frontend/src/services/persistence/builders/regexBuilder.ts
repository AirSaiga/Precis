/**
 * @fileoverview Regex Builder
 *
 * 将 regex 节点转换为 RegexNodeFileV2。
 */

import type { CustomNode, RegexNodeData } from '@/types/graph'
import type { RegexNodeFileV2 } from '@/types/projectV2'
import { normalizeTableId } from '../utils'
import type { BuilderContext, NodeBuilder } from '../types'

export const regexBuilder: NodeBuilder<RegexNodeFileV2> = {
  kind: 'regex',
  matches: (node) => node.type === 'regex',
  build({ node, schemaIdByNodeId }: BuilderContext): { consumed: boolean; file: RegexNodeFileV2 } {
    const data = node.data as RegexNodeData
    const usesPattern = data.uses_pattern

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        name: data.configName || 'Regex',
        description: data.description || undefined,
        pattern: usesPattern ? undefined : data.pattern || '',
        uses_pattern: usesPattern || undefined,
        match_mode: data.matchMode || 'full',
        case_sensitive: !!data.caseSensitive,
        flags: data.flags || '',
        enabled: data.enabled !== false,
        parameters: data.parameters || [],
        rules: data.rules || [],
        source_ref: data.sourceRef
          ? {
              table_id:
                normalizeTableId(data.sourceRef.nodeId, schemaIdByNodeId) || data.sourceRef.nodeId,
              column_id: data.sourceRef.columnId,
            }
          : undefined,
        source_column_name: data.sourceColumnName || undefined,
      },
    }
  },
}

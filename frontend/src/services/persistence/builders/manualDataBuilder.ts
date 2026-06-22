/**
 * @fileoverview ManualData Builder
 *
 * 将 manualData 节点转换为 ManualDataFileV2。
 */

import type { DataType } from '@/types/common'
import type { ManualDataNodeData } from '@/types/graph'
import type { ManualDataFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../types'
const DATA_TYPE_TO_FILE_TYPE: Record<DataType, ManualDataFileV2['column_data_type']> = {
  String: 'string',
  Integer: 'integer',
  Float: 'float',
  Boolean: 'boolean',
  Date: 'date',
  Expression: 'string',
}

export const manualDataBuilder: NodeBuilder<ManualDataFileV2> = {
  kind: 'manualData',
  matches: (node) => node.type === 'manualData',
  build({ node }: BuilderContext): { consumed: boolean; file: ManualDataFileV2 } {
    const data = node.data as ManualDataNodeData

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        column_name: data.columnName || 'Column1',
        column_data_type: data.columnDataType
          ? DATA_TYPE_TO_FILE_TYPE[data.columnDataType]
          : 'string',
        rows: data.rows || [],
        enabled: data.enabled !== false,
        description: data.description || data.configName || undefined,
      },
    }
  },
}

/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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
  Decimal: 'decimal',
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

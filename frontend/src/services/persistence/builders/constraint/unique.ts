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
 * @fileoverview Unique Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs, getSourceRef, normalizeSchemaId } from './helpers'

export const uniqueBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'uniqueConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): {
    consumed: boolean
    file: ConstraintFileV2
  } {
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

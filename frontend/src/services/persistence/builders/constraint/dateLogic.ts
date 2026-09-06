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
 * @fileoverview DateLogic Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs } from './helpers'

export const dateLogicBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'dateLogicConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): {
    consumed: boolean
    file: ConstraintFileV2
  } {
    const d = (node.data || {}) as Record<string, unknown>
    const params: Record<string, unknown> = {
      logic_mode: (d.logicMode as string) || 'compare',
    }

    if (d.logicMode === 'compare') {
      params.compare_op = (d.compareOp as string) || 'gt'
      if (d.compareOp === 'range') {
        if (d.referenceDate) params.reference_date = d.referenceDate
        if (d.referenceColumn) params.reference_column = d.referenceColumn
        if (d.referenceDateEnd) params.reference_date_end = d.referenceDateEnd
        if (d.referenceColumnEnd) params.reference_column_end = d.referenceColumnEnd
      } else {
        if (d.referenceDate) params.reference_date = d.referenceDate
        if (d.referenceColumn) params.reference_column = d.referenceColumn
      }
    } else {
      params.calculation_type = (d.calculationType as string) || 'age'
      if (d.targetValue) params.target_value = d.targetValue
      if (d.targetColumn) params.target_column = d.targetColumn
    }

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'DateLogic',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs: buildSingleColumnRefs(d, nodes, schemaIdByNodeId),
        params,
      },
    }
  },
}

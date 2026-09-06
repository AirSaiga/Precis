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
 * @fileoverview Charset Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildSingleColumnRefs } from './helpers'

export const charsetBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'charsetConstraint',
  build({ node, nodes, schemaIdByNodeId }: BuilderContext): {
    consumed: boolean
    file: ConstraintFileV2
  } {
    const d = (node.data || {}) as Record<string, unknown>
    const params: Record<string, unknown> = {
      charset_mode: d.charsetMode || 'ascii',
    }

    if (d.allowedChars) params.allowed_chars = d.allowedChars
    if (d.disallowedChars) params.disallowed_chars = d.disallowedChars

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'Charset',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        refs: buildSingleColumnRefs(d, nodes, schemaIdByNodeId),
        params,
      },
    }
  },
}

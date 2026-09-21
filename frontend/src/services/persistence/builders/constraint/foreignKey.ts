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
 * @fileoverview ForeignKey Constraint Builder
 */

import type { CustomNode } from '@/types/graph'
import type { ConstraintFileV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../../types'
import { buildForeignKeyRefs } from './helpers'

export const foreignKeyBuilder: NodeBuilder<ConstraintFileV2> = {
  kind: 'constraint',
  matches: (node: CustomNode) => node.type === 'foreignKeyConstraint',
  build({ node, schemaIdByNodeId }: BuilderContext): { consumed: boolean; file: ConstraintFileV2 } {
    const d = (node.data || {}) as Record<string, unknown>

    return {
      consumed: true,
      file: {
        version: 2,
        id: node.id,
        type: 'ForeignKey',
        enabled: d.enabled !== false,
        description: (d.configName as string) || undefined,
        // from/to 双引用 refs 与 Composite 子约束共用 helpers.buildForeignKeyRefs 单一事实源
        refs: buildForeignKeyRefs(d, schemaIdByNodeId),
        // allow_null：FK"允许为空"开关。后端 params 为宽松 dict，先持久化保证 roundtrip；
        // 后端校验器消费该参数属后续后端工作
        params: d.allowNull === true ? { allow_null: true } : {},
      },
    }
  },
}

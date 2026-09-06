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
 * @fileoverview Template Instance Builder
 *
 * 将 templateInstance 节点转换为 TemplateInstanceRefV2。
 */

import type { TemplateInstanceNodeData } from '@/types/graph'
import type { TemplateInstanceRefV2 } from '@/types/projectV2'
import type { BuilderContext, NodeBuilder } from '../types'
export const templateInstanceBuilder: NodeBuilder<TemplateInstanceRefV2> = {
  kind: 'templateInstance',
  matches: (node) => node.type === 'templateInstance',
  build({ node }: BuilderContext): { consumed: boolean; file: TemplateInstanceRefV2 } {
    const data = node.data as TemplateInstanceNodeData

    return {
      consumed: true,
      file: {
        id: node.id,
        template_id: data.templateId || '',
        enabled: data.enabled !== false,
      },
    }
  },
}

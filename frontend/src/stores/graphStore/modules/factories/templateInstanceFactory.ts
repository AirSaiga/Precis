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
 * @file templateInstanceFactory.ts
 * @description 模板实例节点工厂模块 - 负责创建可复用约束模板实例节点
 */

import type { Ref } from 'vue'
import i18n from '@/i18n'
import type { CustomNode } from '@/types/graph'
import { createBaseNodeFactory } from './createBaseNodeFactory'

export function createTemplateInstanceFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  /** 透传给 base 工厂：节点创建前压入撤销快照 */
  saveState?: () => void
}) {
  const { nodes, selectedNodeId, saveState } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId, saveState })

  function createTemplateInstanceNode(
    position: { x: number; y: number },
    templateId?: string,
    templateName?: string,
    options?: {
      nodeId?: string
      enabled?: boolean
      saveState?: 'draft' | 'saved'
    }
  ) {
    return createNode(
      'templateInstance',
      position,
      {
        configName: templateName || i18n.global.t('messages.canvas.newTemplateInstance'),
        templateId: templateId || '',
        templateName: templateName || '',
        enabled: options?.enabled !== false,
        nodeCount: 0,
        summaryText: '',
        expanded: false,
        saveState: options?.saveState || 'draft',
      },
      { nodeId: options?.nodeId, autoSelect: false }
    )
  }

  return {
    createTemplateInstanceNode,
  }
}

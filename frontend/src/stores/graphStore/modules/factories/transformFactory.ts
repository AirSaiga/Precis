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
 * @file transformFactory.ts
 * @description 转换节点工厂模块 - 负责创建和管理数据转换节点
 */

import type { Ref } from 'vue'
import i18n from '@/i18n'
import type { CustomNode, TransformNodeData } from '@/types/graph'
import { createBaseNodeFactory } from './createBaseNodeFactory'

export function createTransformFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  /** 透传给 base 工厂：节点创建前压入撤销快照 */
  saveState?: () => void
}) {
  const { nodes, selectedNodeId, saveState } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId, saveState })

  function createTransformNode(
    position: { x: number; y: number },
    transformType: TransformNodeData['transformType'] = 'StringSplit',
    name?: string
  ) {
    return createNode('transform', position, {
      configName: name || i18n.global.t('messages.canvas.newTransform'),
      transformType,
      description: '',
      inputFromNode: undefined,
      inputColumn: undefined,
      params: {},
      outputColumns: [],
      enabled: true,
      saveState: 'draft',
    })
  }

  return {
    createTransformNode,
  }
}

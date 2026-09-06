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
 * @file transformOutputFactory.ts
 * @description Transform 输出节点工厂模块
 *
 * 核心功能：
 * - createTransformOutputNode: 创建绑定在 transform 上的输出结果节点
 *
 * 设计约束：
 * - 仅由 transform 节点在保存时自动生成
 * - 用户无法从工具箱直接创建
 * - 删除父 transform 时自动级联删除
 */

import type { Ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { createBaseNodeFactory } from './createBaseNodeFactory'

export function createTransformOutputFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  /** 透传给 base 工厂：节点创建前压入撤销快照 */
  saveState?: () => void
}) {
  const { nodes, saveState } = params
  const createNode = createBaseNodeFactory({ nodes, saveState })

  function createTransformOutputNode(
    position: { x: number; y: number },
    parentTransformId: string,
    columnName: string,
    rows: string[][],
    columnDataType?: string
  ) {
    return createNode('transformOutput', position, {
      configName: columnName,
      columnName,
      columnDataType,
      rows,
      parentTransformId,
      saveState: 'draft',
    })
  }

  return {
    createTransformOutputNode,
  }
}

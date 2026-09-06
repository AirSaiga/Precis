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
 * @file jsonSchemaFactory.ts
 * @description JSON Schema 节点工厂
 *
 * 负责在画布上创建 JSON Schema 节点和 JSON Source Preview 节点。
 */

import type { Ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type { CustomNode } from '@/types/graph'
import { createBaseNodeFactory } from './createBaseNodeFactory'
import { i18n } from '@/i18n'

export function createJsonSchemaFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  /** 透传给 base 工厂：节点创建前压入撤销快照 */
  saveState?: () => void
}) {
  const { nodes, selectedNodeId, saveState } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId, saveState })

  function createJsonSchemaNode(
    position: { x: number; y: number },
    name?: string,
    options?: { nodeId?: string }
  ) {
    return createNode(
      'jsonSchema',
      position,
      {
        configName: name || i18n.global.t('factories.defaultName.jsonSchema'),
        tableName: 'json_table',
        sourceType: 'json',
        columns: [],
        saveState: 'draft',
      },
      options ? { nodeId: options.nodeId } : undefined
    )
  }

  function createJsonSourcePreviewNode(
    sourceName: string,
    position: { x: number; y: number },
    fileInfo: {
      fileId: string
      fileName: string
      sourceMode?: 'localfile'
      localPath?: string
      format?: 'array' | 'lines' | 'object'
      jsonPath?: string
      recordPath?: string
    }
  ) {
    return createNode('jsonSourcePreview', position, {
      id: uuidv4(),
      configName: `JsonSource_${sourceName}`,
      sourceName,
      fileName: fileInfo.fileName,
      fileType: 'json',
      sourceType: 'json',
      format: fileInfo.format || 'array',
      jsonPath: fileInfo.jsonPath || '',
      recordPath: fileInfo.recordPath || '',
      isPreviewNode: true,
      outputPortConnected: false,
      sourceMode: fileInfo.sourceMode || 'localfile',
      localPath: fileInfo.localPath,
    })
  }

  return {
    createJsonSchemaNode,
    createJsonSourcePreviewNode,
  }
}

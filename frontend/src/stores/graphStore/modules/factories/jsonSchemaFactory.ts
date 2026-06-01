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

export function createJsonSchemaFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
}) {
  const { nodes, selectedNodeId } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

  function createJsonSchemaNode(position: { x: number; y: number }, name?: string) {
    return createNode('jsonSchema', position, {
      configName: name || '新JSON Schema配置',
      tableName: 'json_table',
      sourceType: 'json',
      columns: [],
      saveState: 'draft',
    })
  }

  function createJsonSourcePreviewNode(
    sourceName: string,
    position: { x: number; y: number },
    fileInfo: {
      fileId: string
      fileName: string
      sourceMode?: 'localfile'
      localPath?: string
    }
  ) {
    return createNode('jsonSourcePreview', position, {
      id: uuidv4(),
      configName: `JsonSource_${sourceName}`,
      sourceName,
      fileName: fileInfo.fileName,
      fileType: 'json',
      sourceType: 'json',
      format: 'auto',
      jsonPath: '',
      recordPath: '',
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

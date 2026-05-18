/**
 * @file manualDataFactory.ts
 * @description 手动数据节点工厂模块 - 负责创建和管理手动输入数据节点
 */

import type { Ref } from 'vue'
import i18n from '@/i18n'
import type { CustomNode } from '@/types/graph'
import { createBaseNodeFactory } from './createBaseNodeFactory'

export function createManualDataFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
}) {
  const { nodes, selectedNodeId } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

  function createManualDataNode(
    position: { x: number; y: number },
    columnName?: string,
    initialRows?: string[][]
  ) {
    return createNode('manualData', position, {
      configName: i18n.global.t('messages.canvas.newManualData'),
      columnName: columnName || 'Column1',
      rows: initialRows || [['value1'], ['value2'], ['value3']],
      saveState: 'draft',
    })
  }

  return {
    createManualDataNode,
  }
}

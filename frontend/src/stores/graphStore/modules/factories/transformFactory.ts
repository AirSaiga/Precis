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
}) {
  const { nodes, selectedNodeId } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

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

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
}) {
  const { nodes, selectedNodeId } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

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

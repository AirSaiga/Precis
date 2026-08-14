/**
 * @file regexFactory.ts
 * @description 正则表达式节点工厂模块 - 负责创建和管理正则校验节点
 */

import type { Ref } from 'vue'
import i18n from '@/i18n'
import type { CustomNode } from '@/types/graph'
import { createBaseNodeFactory } from './createBaseNodeFactory'

export function createRegexFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  /** 透传给 base 工厂：节点创建前压入撤销快照 */
  saveState?: () => void
}) {
  const { nodes, selectedNodeId, saveState } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId, saveState })

  function createRegexNode(position: { x: number; y: number }, pattern?: string, name?: string) {
    return createNode('regex', position, {
      configName: name || i18n.global.t('messages.canvas.newRegex'),
      pattern: pattern || '^.+$',
      description: '',
      parameters: [],
      matchMode: 'full',
      enabled: true,
      caseSensitive: false,
      flags: '',
      validationRules: {},
      rules: [],
      validationStatus: 'idle',
      errorCount: 0,
      totalRows: 0,
      matchCount: 0,
      lastValidationTime: undefined,
    })
  }

  return {
    createRegexNode,
  }
}

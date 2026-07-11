/**
 * @file regexExtractFactory.ts
 * @description 正则提取节点工厂模块 - 负责创建和管理正则提取节点
 *
 * RegexExtract 节点从 Regex 节点中拆分出来，专门用于：
 * - 从上游数据中提取匹配内容
 * - 生成新的数据列并输出到下游节点
 *
 * 序列化时保存为 match_mode='extract' 的 RegexNodeFile。
 */

import type { Ref } from 'vue'
import i18n from '@/i18n'
import type { CustomNode } from '@/types/graph'
import { createBaseNodeFactory } from './createBaseNodeFactory'

export function createRegexExtractFactoryModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
}) {
  const { nodes, selectedNodeId } = params
  const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

  function createRegexExtractNode(
    position: { x: number; y: number },
    pattern?: string,
    name?: string
  ) {
    return createNode('regexExtract', position, {
      configName: name || i18n.global.t('messages.canvas.newRegexExtract'),
      pattern: pattern || '^.+$',
      description: '',
      flags: '',
      caseSensitive: false,
      enabled: true,
      captureGroups: [],
      outputColumns: [],
      rules: [],
      validationStatus: 'idle',
      saveState: 'draft',
    })
  }

  return {
    createRegexExtractNode,
  }
}

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

export function createTransformOutputFactoryModule(params: { nodes: Ref<CustomNode[]> }) {
  const { nodes } = params
  const createNode = createBaseNodeFactory({ nodes })

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

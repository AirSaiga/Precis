/**
 * @file createBaseNodeFactory.ts
 * @description 通用节点工厂基函数
 *
 * 封装所有节点创建的共同流程：生成 UUID → 组装节点 → 注册到画布 → 设置选中状态。
 * 各专用工厂只需负责组装 data 对象，不再重复样板代码。
 */

import type { Ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { addNodes } from '@/services/canvas/vueFlowApi'

export interface BaseFactoryContext {
  nodes: Ref<CustomNode[]>
  selectedNodeId?: Ref<string | null>
}

export function createBaseNodeFactory(ctx: BaseFactoryContext) {
  const { nodes, selectedNodeId } = ctx

  return function createNode<TData extends Record<string, unknown>>(
    type: string,
    position: { x: number; y: number },
    data: TData,
    options?: { autoSelect?: boolean; nodeId?: string }
  ): string {
    const newNode: CustomNode = {
      id: options?.nodeId || uuidv4(),
      type,
      position,
      data: data as unknown as CustomNodeData,
    }

    addNodes(newNode)

    if (options?.autoSelect !== false && selectedNodeId) {
      selectedNodeId.value = newNode.id
    }

    return newNode.id
  }
}

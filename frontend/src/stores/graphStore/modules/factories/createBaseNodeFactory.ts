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
import { addNodes, findNode } from '@/services/canvas/vueFlowApi'
import { NODE_ENTER_DURATION_MS, NODE_ENTERING_CLASS } from '@/services/canvas/animationDurations'
export interface BaseFactoryContext {
  nodes: Ref<CustomNode[]>
  selectedNodeId?: Ref<string | null>
  /** 节点创建前压入撤销快照（可选，历史模块注入）。
   * 项目加载直接构建 nodes.value，不经 createNode，故不会污染撤销栈。 */
  saveState?: () => void
}

export function createBaseNodeFactory(ctx: BaseFactoryContext) {
  const { nodes, selectedNodeId, saveState } = ctx

  /**
   * 清除节点上的临时动画 class。
   *
   * 关键约束：必须用 findNode 增量改 Vue Flow 内部响应式 GraphNode 的 class，
   * 不能用 nodes.value = [...] 全量替换——全量替换会走 setNodes，绕过 Vue Flow
   * 的增量 hooks，在节点→边关联场景下可能导致隐性状态不一致。此处的直接赋值是
   * 增量更新，与边动画清理（findEdge）保持同一模式。
   */
  function clearNodeClass(nodeId: string, className: string): void {
    const vfNode = findNode(nodeId)
    if (vfNode && vfNode.class === className) {
      vfNode.class = undefined
    }
  }

  return function createNode<TData extends Record<string, unknown>>(
    type: string,
    position: { x: number; y: number },
    data: TData,
    options?: { autoSelect?: boolean; nodeId?: string }
  ): string {
    // 创建前压入撤销快照（所有 store.createXxxNode 工厂的唯一汇聚点）
    saveState?.()

    const autoSelect = options?.autoSelect !== false && !!selectedNodeId

    const newNode: CustomNode = {
      id: options?.nodeId || uuidv4(),
      type,
      position,
      data: data as unknown as CustomNodeData,
      // 标记入场动画；Vue Flow 原生支持 node.class，渲染时即附加到包装元素
      class: NODE_ENTERING_CLASS,
    }

    if (autoSelect) {
      // 选择模型统一：新建节点应收敛为唯一选中。
      // 仅写 selectedNodeId 不清 selectedNodeIds 会导致"框选 A/B/C 后新建 D，
      // Delete/Ctrl+C 仍作用于 A/B/C"。此处同步维护 Vue Flow 内部选中集：
      // 清除旧选中 + 新节点带 selected 入图，viewportSync watcher 会将
      // selectedNodeIds 收敛为 [newNode.id]。
      // 直接改内部 GraphNode.selected 与下方 clearNodeClass 同为增量修改模式。
      for (const n of nodes.value) {
        if (n.selected) {
          const vfNode = findNode(n.id)
          if (vfNode?.selected) {
            vfNode.selected = false
          }
          n.selected = false
        }
      }
      newNode.selected = true
    }

    addNodes(newNode)

    // 动画结束后清除 class（仅作用于手动新增 / 资源树拖入 / AI 生成路径；
    // 项目加载直接构建 nodes.value，不经 createNode，故不会触发入场动画）
    setTimeout(() => clearNodeClass(newNode.id, NODE_ENTERING_CLASS), NODE_ENTER_DURATION_MS)

    if (autoSelect && selectedNodeId) {
      selectedNodeId.value = newNode.id
    }

    return newNode.id
  }
}

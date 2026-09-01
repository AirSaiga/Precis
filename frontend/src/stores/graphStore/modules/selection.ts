/**
 * @file selection.ts
 * @description 画布选中/多选状态管理
 *
 * 该模块集中管理 selectedNodeId/selectedNodeIds 状态与操作。
 * 采用依赖注入方式接入 graphStore，避免循环依赖。
 */

import type { Ref } from 'vue'
import type { CustomNode } from '@/types/graph'
import { findNode, VueFlowApiNotInitializedError } from '@/services/canvas/vueFlowApi'

/**
 * @description 创建画布节点选择管理模块
 * @param {Object} params - 依赖注入参数对象
 * @param {Ref<CustomNode[]>} params.nodes - 画布节点列表的响应式引用
 * @param {Ref<string | null>} params.selectedNodeId - 当前单选节点 ID
 * @param {Ref<string[]>} params.selectedNodeIds - 当前多选节点 ID 列表
 * @returns {Object} 包含各类选择操作方法的对象
 */
export function createSelectionModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  selectedNodeIds: Ref<string[]>
}) {
  const { nodes, selectedNodeId, selectedNodeIds } = params

  /**
   * @description 选中所有节点
   * @returns {void}
   *
   * 逻辑说明：
   * - 将所有节点 ID 填入多选列表
   * - 将最后一名节点设为单选焦点，保证属性面板有内容展示
   * - 同步标记 Vue Flow 内部选中集：选中状态是"Store + VF"双模型，仅写 Store
   *   会让两者不一致，下一次 VF→Store 同步就会用 VF 旧选中集覆写全选结果
   */
  function selectAllNodes() {
    if (nodes.value.length > 0) {
      try {
        for (const n of nodes.value) {
          const vfNode = findNode(n.id)
          if (vfNode && !vfNode.selected) {
            vfNode.selected = true
          }
        }
      } catch (error) {
        // 画布未挂载（vueFlowApi 未初始化）时跳过 VF 侧同步，仅更新 Store
        if (!(error instanceof VueFlowApiNotInitializedError)) {
          throw error
        }
      }
      selectedNodeIds.value = nodes.value.map((n) => n.id)
      const lastNode = nodes.value[nodes.value.length - 1]
      if (lastNode) {
        selectedNodeId.value = lastNode.id
      }
    }
  }

  /**
   * @description 清除所有选中状态（单选和多选）
   * @returns {void}
   */
  function clearSelection() {
    selectedNodeIds.value = []
    selectedNodeId.value = null
  }

  /**
   * @description 设置多选状态（覆盖之前的选中结果）
   * @param {string[]} nodeIds - 要设为选中的节点 ID 数组
   * @returns {void}
   *
   * 逻辑说明：
   * - 仅选中一个节点时，同步更新单选焦点
   * - 未选中任何节点时，清空单选焦点
   */
  function setSelection(nodeIds: string[]) {
    selectedNodeIds.value = [...nodeIds]
    if (nodeIds.length === 1) {
      const firstId = nodeIds[0]
      if (firstId !== undefined) {
        selectedNodeId.value = firstId
      }
    } else if (nodeIds.length === 0) {
      selectedNodeId.value = null
    }
  }

  return {
    selectAllNodes,
    clearSelection,
    setSelection,
  }
}

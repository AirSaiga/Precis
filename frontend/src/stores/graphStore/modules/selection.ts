/**
 * @file selection.ts
 * @description 画布选中/多选/框选
 *
 * 该模块集中管理 selectedNodeId/selectedNodeIds/selectionBox 等状态与操作。
 * 采用依赖注入方式接入 graphStore，避免循环依赖。
 */

import type { Ref } from 'vue'
import type { GraphNode } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'

/**
 * @description 创建画布节点选择管理模块
 * @param {Object} params - 依赖注入参数对象
 * @param {Ref<CustomNode[]>} params.nodes - 画布节点列表的响应式引用
 * @param {Ref<string | null>} params.selectedNodeId - 当前单选节点 ID
 * @param {Ref<string[]>} params.selectedNodeIds - 当前多选节点 ID 列表
 * @param {Ref<{ x: number; y: number; width: number; height: number } | null>} params.selectionBox - 框选区域的矩形坐标
 * @param {Ref<boolean>} params.isSelecting - 是否处于框选模式
 * @returns {Object} 包含各类选择操作方法的对象
 */
export function createSelectionModule(params: {
  nodes: Ref<CustomNode[]>
  selectedNodeId: Ref<string | null>
  selectedNodeIds: Ref<string[]>
  selectionBox: Ref<{ x: number; y: number; width: number; height: number } | null>
  isSelecting: Ref<boolean>
}) {
  const { nodes, selectedNodeId, selectedNodeIds, selectionBox, isSelecting } = params

  /**
   * @description 选中所有节点
   * @returns {void}
   *
   * 逻辑说明：
   * - 将所有节点 ID 填入多选列表
   * - 将最后一名节点设为单选焦点，保证属性面板有内容展示
   */
  function selectAllNodes() {
    if (nodes.value.length > 0) {
      selectedNodeIds.value = nodes.value.map((n) => n.id)
      const lastNode = nodes.value[nodes.value.length - 1]
      if (lastNode) {
        selectedNodeId.value = lastNode.id
      }
    }
  }

  /**
   * @description 将指定节点添加到多选列表
   * @param {string} nodeId - 要添加的节点唯一标识符
   * @returns {void}
   */
  function addToSelection(nodeId: string) {
    // 去重：仅当节点不在列表中时才追加
    if (!selectedNodeIds.value.includes(nodeId)) {
      // [safe-push] selectedNodeIds 是独立的响应式数组，非 Vue Flow 节点/边
      selectedNodeIds.value.push(nodeId)
    }
  }

  /**
   * @description 将指定节点从多选列表中移除
   * @param {string} nodeId - 要移除的节点唯一标识符
   * @returns {void}
   */
  function removeFromSelection(nodeId: string) {
    selectedNodeIds.value = selectedNodeIds.value.filter((id) => id !== nodeId)
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

  /**
   * @description 根据框选区域（矩形）计算被包含的节点，并设为选中
   * @param {Object} box - 框选区域矩形
   * @param {number} box.x - 矩形起点 X 坐标（相对于画布）
   * @param {number} box.y - 矩形起点 Y 坐标（相对于画布）
   * @param {number} box.width - 矩形宽度（可为负值，表示向左拖拽）
   * @param {number} box.height - 矩形高度（可为负值，表示向上拖拽）
   * @returns {void}
   *
   * 计算逻辑：
   * 1. 将 width/height 可能为负的矩形标准化为 left/right/top/bottom
   * 2. 以每个节点的中心点作为判定基准
   * 3. 若中心点落在矩形内，则判定该节点被选中
   */
  function setSelectionFromBox(box: { x: number; y: number; width: number; height: number }) {
    const selectedIds: string[] = []

    // 由于拖拽方向不确定，width/height 可能为负，先标准化为绝对边界
    const boxLeft = Math.min(box.x, box.x + box.width)
    const boxRight = Math.max(box.x, box.x + box.width)
    const boxTop = Math.min(box.y, box.y + box.height)
    const boxBottom = Math.max(box.y, box.y + box.height)

    for (const node of nodes.value) {
      const graphNode = node as unknown as GraphNode
      const nodeWidth = graphNode.dimensions?.width || 260
      const nodeHeight = graphNode.dimensions?.height || 120

      const nodeCenterX = node.position.x + nodeWidth / 2
      const nodeCenterY = node.position.y + nodeHeight / 2

      // 判定中心点是否在框选矩形内部
      if (
        nodeCenterX >= boxLeft &&
        nodeCenterX <= boxRight &&
        nodeCenterY >= boxTop &&
        nodeCenterY <= boxBottom
      ) {
        selectedIds.push(node.id)
      }
    }

    // 将计算出的选中节点 ID 应用到选择状态
    setSelection(selectedIds)
  }

  /**
   * @description 设置框选区域矩形
   * @param {{ x: number; y: number; width: number; height: number } | null} box - 框选区域，传 null 表示清除框选框
   * @returns {void}
   */
  function setSelectionBox(box: { x: number; y: number; width: number; height: number } | null) {
    selectionBox.value = box
  }

  /**
   * @description 设置是否处于框选模式
   * @param {boolean} selecting - true 表示开始框选，false 表示结束框选
   * @returns {void}
   */
  function setSelecting(selecting: boolean) {
    isSelecting.value = selecting
  }

  return {
    selectAllNodes,
    addToSelection,
    removeFromSelection,
    clearSelection,
    setSelection,
    setSelectionFromBox,
    setSelectionBox,
    setSelecting,
  }
}

/**
 * @file history.ts
 * @description 画布历史记录（撤销/重做）
 *
 * 该模块负责维护 nodes/edges 的历史快照栈，并提供 undo/redo/saveState 能力。
 * 采用"依赖注入"方式接入 graphStore，避免反向依赖 store 造成循环引用。
 */

import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'

/**
 * @description 历史快照数据结构
 * @property {CustomNode[]} nodes - 某一时刻画布上的所有节点副本
 * @property {Edge[]} edges - 某一时刻画布上的所有边副本
 */
interface HistorySnapshot {
  nodes: CustomNode[]
  edges: Edge[]
}

/**
 * @description 创建画布历史记录管理模块
 * @param {Object} params - 依赖注入参数对象
 * @param {Ref<CustomNode[]>} params.nodes - 画布节点列表的响应式引用
 * @param {Ref<Edge[]>} params.edges - 画布边列表的响应式引用
 * @param {number} [params.maxHistoryLength=50] - 撤销栈最大长度，超过时自动丢弃最旧记录
 * @returns {Object} 包含 undoStack、redoStack、saveState、undo、redo 的操作对象
 */
export function createHistoryModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  maxHistoryLength?: number
}) {
  const { nodes, edges } = params
  // 若未传入最大历史长度，默认保留 50 条记录
  const maxHistoryLength = params.maxHistoryLength ?? 50

  // 撤销栈：存放每一步操作前的状态快照
  const undoStack = ref<HistorySnapshot[]>([])
  // 重做栈：存放被撤销的状态快照，执行新操作时会清空
  const redoStack = ref<HistorySnapshot[]>([])

  /**
   * @description 保存当前画布状态到撤销栈
   * @returns {void}
   *
   * 执行逻辑：
   * 1. 深拷贝当前 nodes 和 edges
   * 2. 将快照压入撤销栈
   * 3. 清空重做栈（新操作后旧重做记录失效）
   * 4. 若撤销栈超出上限，移除最旧记录
   */
  function saveState() {
    // 使用 structuredClone 进行深拷贝，避免后续修改影响历史快照
    const snapshot = structuredClone({ nodes: nodes.value, edges: edges.value })

    undoStack.value.push(snapshot)
    // 新操作产生后，之前的重做记录不再有效
    redoStack.value = []

    // 超出最大长度时，移除栈底最旧记录
    if (undoStack.value.length > maxHistoryLength) {
      undoStack.value.shift()
    }
  }

  /**
   * @description 撤销上一步操作
   * @returns {Promise<void>}
   *
   * 执行逻辑：
   * 1. 若撤销栈为空则直接返回
   * 2. 将当前状态深拷贝后压入重做栈
   * 3. 从撤销栈弹出上一个状态并恢复
   */
  async function undo() {
    // 无历史记录时无法撤销
    if (undoStack.value.length === 0) {
      return
    }

    // 先保存当前状态，方便后续重做
    const currentSnapshot = structuredClone({ nodes: nodes.value, edges: edges.value })
    redoStack.value.push(currentSnapshot)

    // 弹出撤销栈顶的上一个状态并恢复
    const previousState = undoStack.value.pop()
    if (previousState) {
      nodes.value = previousState.nodes
      edges.value = previousState.edges
    }
  }

  /**
   * @description 重做被撤销的操作
   * @returns {Promise<void>}
   *
   * 执行逻辑：
   * 1. 若重做栈为空则直接返回
   * 2. 将当前状态深拷贝后压入撤销栈
   * 3. 从重做栈弹出下一个状态并恢复
   */
  async function redo() {
    // 无重做记录时直接返回
    if (redoStack.value.length === 0) {
      return
    }

    // 先保存当前状态，方便后续再次撤销
    const currentSnapshot = structuredClone({ nodes: nodes.value, edges: edges.value })
    undoStack.value.push(currentSnapshot)

    // 弹出重做栈顶的下一个状态并恢复
    const nextState = redoStack.value.pop()
    if (nextState) {
      nodes.value = nextState.nodes
      edges.value = nextState.edges
    }
  }

  return {
    undoStack,
    redoStack,
    saveState,
    undo,
    redo,
  }
}

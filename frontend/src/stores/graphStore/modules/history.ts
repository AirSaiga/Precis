/**
 * @file history.ts
 * @description 画布历史记录（撤销/重做）
 *
 * 该模块负责维护 nodes/edges 的历史快照栈，并提供 undo/redo/saveState 能力。
 * 采用"依赖注入"方式接入 graphStore，避免反向依赖 store 造成循环引用。
 */

import { shallowRef, toRaw, nextTick, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { deepToRaw } from '@/utils/typeHelpers'

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
 * 递归剥离 Vue reactive proxy：toRaw 只解包最外层，嵌套对象仍是 proxy，
 * 直接 structuredClone 会抛 DataCloneError。必须逐元素递归解包。
 *
 * 该函数是**纯函数**：返回新数组/对象，不就地修改源元素。
 * 这很关键——因为 toRaw 返回的是 proxy 的底层 target，直接对其赋值会穿透回写
 * 到 nodes.value 仍引用的同一活跃对象，造成未声明的副作用。
 */
function deepToRawArray<T>(arr: T[]): T[] {
  return arr.map((item): T => {
    if (item === null || typeof item !== 'object') return item
    const raw = toRaw(item)
    return deepToRaw(raw) as T
  })
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
  reconcileAll?: () => void | Promise<void>
}) {
  const { nodes, edges, reconcileAll } = params
  // 若未传入最大历史长度，默认保留 50 条记录
  const maxHistoryLength = params.maxHistoryLength ?? 50

  // 撤销栈：存放每一步操作前的状态快照
  const undoStack = shallowRef<HistorySnapshot[]>([])
  // 重做栈：存放被撤销的状态快照，执行新操作时会清空
  const redoStack = shallowRef<HistorySnapshot[]>([])

  function cloneCurrent(): HistorySnapshot {
    return structuredClone({
      nodes: deepToRawArray(toRaw(nodes.value)),
      edges: deepToRawArray(toRaw(edges.value)),
    })
  }

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
    const snapshot = cloneCurrent()

    undoStack.value = [...undoStack.value, snapshot]
    redoStack.value = []

    if (undoStack.value.length > maxHistoryLength) {
      undoStack.value = undoStack.value.slice(1)
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
    if (undoStack.value.length === 0) {
      return
    }

    const currentSnapshot = cloneCurrent()
    redoStack.value = [...redoStack.value, currentSnapshot]

    const previousState = undoStack.value[undoStack.value.length - 1]
    undoStack.value = undoStack.value.slice(0, -1)

    if (!previousState) return
    // 深克隆恢复源快照，避免后续对 nodes.value 的就地修改（如 Object.assign(node.data, ...)）
    // 回写污染历史栈中仍可能被引用的同一快照对象。
    const restored = structuredClone(previousState)
    nodes.value = restored.nodes
    edges.value = restored.edges

    if (reconcileAll) {
      await nextTick()
      await reconcileAll()
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
    if (redoStack.value.length === 0) {
      return
    }

    const currentSnapshot = cloneCurrent()
    undoStack.value = [...undoStack.value, currentSnapshot]

    const nextState = redoStack.value[redoStack.value.length - 1]
    redoStack.value = redoStack.value.slice(0, -1)

    if (!nextState) return
    // 深克隆恢复源快照，避免后续对 nodes.value 的就地修改回写污染重做栈中的同一快照对象。
    const restored = structuredClone(nextState)
    nodes.value = restored.nodes
    edges.value = restored.edges

    if (reconcileAll) {
      await nextTick()
      await reconcileAll()
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

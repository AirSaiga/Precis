/**
 * @file vueFlowApi.ts
 * @description Vue Flow API 注入层 — 所有 DAG 操作统一通过本模块调用 Vue Flow 原生 API
 *
 * 使用方式：
 * 1. NodeCanvas.vue 在 setup 中调用 initVueFlowApi(useVueFlow()) 完成注入
 * 2. 业务代码通过导出的 addNodes / addEdges / removeNodes / removeEdges 操作画布
 *
 * 为什么不直接在 Pinia store 中调用 useVueFlow()？
 * → useVueFlow() 依赖 Vue Flow 的 provide/inject，只能在 Vue 组件 setup 中调用。
 *   Pinia store 不在组件上下文中，因此通过本模块做桥接。
 */

import type {
  GraphEdge,
  GraphNode,
  AddNodes,
  AddEdges,
  RemoveNodes,
  RemoveEdges,
  UpdateNodeInternals,
  UpdateEdgeData,
  FindEdge,
  FindNode,
  UpdateNodeData,
  UpdateNode,
  FitView,
} from '@vue-flow/core'

export interface VueFlowApi {
  addNodes: AddNodes
  addEdges: AddEdges
  removeNodes: RemoveNodes
  removeEdges: RemoveEdges
  updateNodeInternals: UpdateNodeInternals
  updateEdgeData: UpdateEdgeData
  findEdge: FindEdge
  findNode: FindNode
  updateNodeData: UpdateNodeData
  updateNode: UpdateNode
  fitView: FitView
  /**
   * 屏幕坐标 → flow 坐标。可选成员：测试替身与降级路径可缺席，
   * 调用方（如工具箱落点计算）需判空并走回退逻辑。
   */
  screenToFlowCoordinate?: (position: { x: number; y: number }) => { x: number; y: number }
}

let _api: VueFlowApi | null = null

/**
 * Vue Flow API 尚未初始化时抛出的异常。
 * 用于调用方区分“未初始化”与真正的 Vue Flow 运行时错误。
 */
export class VueFlowApiNotInitializedError extends Error {
  constructor() {
    super('[vueFlowApi] 未初始化。请在 NodeCanvas.vue setup 中调用 initVueFlowApi()。')
    this.name = 'VueFlowApiNotInitializedError'
  }
}

function requireApi(): VueFlowApi {
  if (!_api) throw new VueFlowApiNotInitializedError()
  return _api
}

export function initVueFlowApi(api: VueFlowApi) {
  _api = api
}

/**
 * 重置 Vue Flow API 单例（置为 null）。
 *
 * NodeCanvas 卸载时调用，避免模式切换（IDE ↔ Agent）的重建窗口期内，
 * 飞行中的异步调用方（如 AI 指令流）命中已销毁的旧 Vue Flow 实例。
 * 重置后调用方会抛 VueFlowApiNotInitializedError，可被捕获做降级处理。
 */
export function resetVueFlowApi(): void {
  _api = null
}

/**
 * 获取画布视口中心对应的 flow 坐标。
 *
 * 用于工具箱创建节点时的落点计算（见 services/canvas/spawnPosition.ts）。
 * Vue Flow 未初始化、未提供 screenToFlowCoordinate、或画布 DOM 尚未挂载时返回 null，
 * 调用方需回退到默认坐标。
 */
export function getViewportCenterInFlowCoords(): { x: number; y: number } | null {
  if (!_api?.screenToFlowCoordinate) return null
  const pane = document.querySelector('.vue-flow')
  if (!pane) return null
  const rect = pane.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  return _api.screenToFlowCoordinate({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  })
}

export function addNodes(...args: Parameters<AddNodes>) {
  requireApi().addNodes(...args)
}

export function addEdges(...args: Parameters<AddEdges>) {
  requireApi().addEdges(...args)
}

export function removeNodes(...args: Parameters<RemoveNodes>) {
  requireApi().removeNodes(...args)
}

export function removeEdges(...args: Parameters<RemoveEdges>) {
  requireApi().removeEdges(...args)
}

export function updateNodeInternals(...args: Parameters<UpdateNodeInternals>) {
  requireApi().updateNodeInternals(...args)
}

export function updateEdgeData(...args: Parameters<UpdateEdgeData>) {
  requireApi().updateEdgeData(...args)
}

export function findEdge(...args: Parameters<FindEdge>): GraphEdge | undefined {
  return requireApi().findEdge(...args)
}

export function findNode(...args: Parameters<FindNode>): GraphNode | undefined {
  return requireApi().findNode(...args)
}

export function updateNodeData(...args: Parameters<UpdateNodeData>) {
  requireApi().updateNodeData(...args)
}

export function updateNode(...args: Parameters<UpdateNode>) {
  requireApi().updateNode(...args)
}

export function fitView(...args: Parameters<FitView>) {
  requireApi().fitView(...args)
}

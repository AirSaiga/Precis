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

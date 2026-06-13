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
  AddNodes,
  AddEdges,
  RemoveNodes,
  RemoveEdges,
  UpdateNodeInternals,
  UpdateEdgeData,
  FindEdge,
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
  updateNodeData: UpdateNodeData
  updateNode: UpdateNode
  fitView: FitView
}

let _api: VueFlowApi | null = null

function requireApi(): VueFlowApi {
  if (!_api)
    throw new Error('[vueFlowApi] 未初始化。请在 NodeCanvas.vue setup 中调用 initVueFlowApi()。')
  return _api
}

export function initVueFlowApi(api: VueFlowApi) {
  _api = api
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

export function updateNodeData(...args: Parameters<UpdateNodeData>) {
  requireApi().updateNodeData(...args)
}

export function updateNode(...args: Parameters<UpdateNode>) {
  requireApi().updateNode(...args)
}

export function fitView(...args: Parameters<FitView>) {
  requireApi().fitView(...args)
}

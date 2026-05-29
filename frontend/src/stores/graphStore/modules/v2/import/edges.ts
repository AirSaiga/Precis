/**
 * @file edges.ts
 * @description V2 导入边管理模块（带缓冲机制）
 *
 * 导入流程中节点刚通过 addNodes 创建，尚未渲染，没有 handleBounds。
 * 若立即调用 addEdges，边无法计算路径。
 *
 * 解决方案：先缓冲边数据，在调用方 await nextTick()（节点已渲染）后
 * 统一调用 flushBufferedEdges() → addEdges()。
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { addEdges } from '@/services/canvas/vueFlowApi'

export function createV2ImportEdges(params: { edges: Ref<Edge[]> }) {
  const { edges } = params
  const buffer: Edge[] = []

  const ensureSchemaToRegexEdge = (tableId: string, regexId: string, columnId: string) => {
    const edgeId = `e-${tableId}-${regexId}-${columnId}`
    if (edges.value.some((e) => e.id === edgeId)) return
    if (buffer.some((e) => e.id === edgeId)) return
    buffer.push({
      id: edgeId,
      source: tableId,
      target: regexId,
      sourceHandle: `source-right-${columnId}`,
      targetHandle: 'regex-input',
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 },
    } as unknown as Edge)
  }

  const ensureSchemaToConstraintEdge = (tableId: string, constraintId: string, columnId: string) => {
    const edgeId = `e-${tableId}-${constraintId}-${columnId}`
    if (edges.value.some((e) => e.id === edgeId)) return
    if (buffer.some((e) => e.id === edgeId)) return
    buffer.push({
      id: edgeId,
      source: tableId,
      target: constraintId,
      sourceHandle: `source-right-${columnId}`,
      targetHandle: `target-input-${constraintId}`,
      type: 'smoothstep',
    })
  }

  /** 缓冲一条 FK 展示边（由 constraint.ts 调用） */
  const bufferEdge = (edge: Edge) => {
    if (edges.value.some((e) => e.id === edge.id)) return
    if (buffer.some((e) => e.id === edge.id)) return
    buffer.push(edge)
  }

  /** 将缓冲的边统一通过 addEdges 提交，并清空缓冲 */
  const flushBufferedEdges = () => {
    if (buffer.length === 0) return
    addEdges(buffer)
    buffer.length = 0
  }

  return { ensureSchemaToRegexEdge, ensureSchemaToConstraintEdge, bufferEdge, flushBufferedEdges }
}

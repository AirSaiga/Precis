/**
 * @file edges.ts
 * @description V2 导入边管理模块
 *
 * 负责在导入 V2 配置时创建和维护画布中节点之间的连接边。
 * 提供幂等的边创建函数，避免重复添加相同边。
 *
 * 核心功能：
 * - ensureSchemaToRegexEdge: 建立 Schema 节点到 Regex 节点的边
 * - ensureSchemaToConstraintEdge: 建立 Schema 节点到 Constraint 节点的边
 *
 * 设计要点：
 * - 边 ID 采用规范命名：e-{source}-{target}-{columnId}
 * - 使用 sourceHandle / targetHandle 精确指定连接端口
 * - 边样式通过 CSS 变量统一控制
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'

export function createV2ImportEdges(params: { edges: Ref<Edge[]> }) {
  const { edges } = params

  const ensureSchemaToRegexEdge = (tableId: string, regexId: string, columnId: string) => {
    const edgeId = `e-${tableId}-${regexId}-${columnId}`
    if (edges.value.some(e => e.id === edgeId)) return
    edges.value.push({
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
    if (edges.value.some(e => e.id === edgeId)) return
    edges.value.push({
      id: edgeId,
      source: tableId,
      target: constraintId,
      sourceHandle: `source-right-${columnId}`,
      targetHandle: `target-input-${constraintId}`,
      type: 'smoothstep',
    })
  }

  return { ensureSchemaToRegexEdge, ensureSchemaToConstraintEdge }
}


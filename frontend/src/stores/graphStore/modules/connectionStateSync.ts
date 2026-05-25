/**
 * @fileoverview 连接状态同步模块 - 统一管理 parent/children/outputPortConnected 字段
 *
 * 功能概述:
 * - syncOnConnect: 连接建立后，统一更新 source.children / target.parent / outputPortConnected
 * - syncOnDisconnect: 连接断开后，统一清理上述字段
 * - reconcileAll: 从现有 edges 重建所有关系状态（用于 V2 导入后）
 *
 * 架构设计:
 * - 本模块是 parent/children/outputPortConnected 维护的唯一入口（Single Source of Truth）
 * - 所有连接/断开路径应通过本模块操作，而非 inline 维护
 * - reconcileAll 是幂等操作，可安全重复调用
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { logger } from '@/core/utils/logger'

// ============================================================================
// 节点类型分类
// ============================================================================

/** 拥有 children 字段的源节点类型 */
const CHILDREN_CAPABLE_TYPES = new Set([
  'sourcePreview',
  'jsonSourcePreview',
  'schema',
  'jsonSchema',
  'manualData',
  'transformOutput',
])

/** 数据源类型（需要维护 outputPortConnected） */
const DATA_SOURCE_TYPES = new Set(['sourcePreview', 'jsonSourcePreview'])

/** 数据源连接的下游目标类型 */
const SCHEMA_TYPES = new Set(['schema', 'jsonSchema'])

/** 需要跳过的边类型标识 */
const SKIP_EDGE_KINDS = new Set(['fkDisplay'])

// ============================================================================
// 辅助函数
// ============================================================================

function isChildrenCapableType(type: string | undefined): boolean {
  return !!type && CHILDREN_CAPABLE_TYPES.has(type)
}

function isParentCapableType(type: string | undefined): boolean {
  return type === 'regex' || isConstraintNodeType(type)
}

function isDataSourceType(type: string | undefined): boolean {
  return !!type && DATA_SOURCE_TYPES.has(type)
}

function isSchemaType(type: string | undefined): boolean {
  return !!type && SCHEMA_TYPES.has(type)
}

function shouldSkipEdge(edge: Edge): boolean {
  const data = (edge as unknown as { data?: Record<string, unknown> }).data
  if (!data) return false
  if (data.transient === true) return true
  if (data.kind && SKIP_EDGE_KINDS.has(data.kind as string)) return true
  return false
}

// ============================================================================
// 模块工厂
// ============================================================================

export interface ConnectionStateSyncContext {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
}

export function createConnectionStateSyncModule(ctx: ConnectionStateSyncContext) {
  const { nodes, edges, updateNodeData } = ctx

  // ========================================================================
  // 内部：单条边的连接状态应用
  // ========================================================================

  /**
   * 对一条已确认有效的边，应用 children/parent/outputPortConnected 状态更新。
   * 用于 syncOnConnect 和 reconcileAll 内部。
   */
  function applyConnectState(
    sourceId: string,
    targetId: string,
    patchFn: (nodeId: string, patch: Record<string, unknown>) => void
  ) {
    const sourceNode = nodes.value.find((n) => n.id === sourceId)
    const targetNode = nodes.value.find((n) => n.id === targetId)
    if (!sourceNode || !targetNode) return

    const sourceData = sourceNode.data as unknown as Record<string, unknown>
    const targetData = targetNode.data as unknown as Record<string, unknown>

    // 更新 source.children
    if (isChildrenCapableType(sourceNode.type)) {
      const currentChildren = (sourceData.children as string[]) || []
      if (!currentChildren.includes(targetId)) {
        patchFn(sourceId, { children: [...currentChildren, targetId] })
      }
    }

    // 更新 target.parent
    if (isParentCapableType(targetNode.type)) {
      if (targetData.parent !== sourceId) {
        patchFn(targetId, { parent: sourceId })
      }
    }

    // 更新 outputPortConnected
    if (isDataSourceType(sourceNode.type) && isSchemaType(targetNode.type)) {
      if (sourceData.outputPortConnected !== true) {
        patchFn(sourceId, { outputPortConnected: true })
      }
    }
  }

  // ========================================================================
  // syncOnConnect
  // ========================================================================

  /**
   * 连接建立后调用 — 统一更新 children/parent/outputPortConnected。
   *
   * @param sourceId 源节点 ID
   * @param targetId 目标节点 ID
   * @param patchFn 可选的 patch 函数（用于事务内），不传则使用 updateNodeData
   */
  function syncOnConnect(
    sourceId: string,
    targetId: string,
    patchFn?: (nodeId: string, patch: Record<string, unknown>) => void
  ) {
    const fn = patchFn || ((id: string, patch: Record<string, unknown>) => updateNodeData(id, patch as Partial<CustomNodeData>))
    applyConnectState(sourceId, targetId, fn)
  }

  // ========================================================================
  // syncOnDisconnect
  // ========================================================================

  /**
   * 连接断开后调用 — 统一清理 children/parent/outputPortConnected。
   *
   * 注意：调用者应已跳过瞬态边。FK 展示边由本函数内部跳过。
   */
  function syncOnDisconnect(edge: Edge) {
    // 跳过 FK 展示边
    if (shouldSkipEdge(edge)) return

    const sourceNode = nodes.value.find((n) => n.id === edge.source)
    const targetNode = nodes.value.find((n) => n.id === edge.target)
    if (!sourceNode || !targetNode) return

    const sourceData = sourceNode.data as unknown as Record<string, unknown>

    // 清理 source.children
    if (isChildrenCapableType(sourceNode.type)) {
      const currentChildren = (sourceData.children as string[]) || []
      if (currentChildren.includes(edge.target)) {
        const newChildren = currentChildren.filter((id) => id !== edge.target)
        updateNodeData(edge.source, {
          children: newChildren.length > 0 ? newChildren : undefined,
        } as Partial<CustomNodeData>)
      }
    }

    // 清理 target.parent
    if (isParentCapableType(targetNode.type)) {
      const targetData = targetNode.data as unknown as Record<string, unknown>
      if (targetData.parent === edge.source) {
        updateNodeData(edge.target, { parent: undefined } as Partial<CustomNodeData>)
      }
    }

    // 清理 outputPortConnected：仅当数据源节点不再有任何 schema 类型的下游连接时重置
    if (isDataSourceType(sourceNode.type)) {
      const hasRemainingSchemaConnection = edges.value.some(
        (e) =>
          e.source === edge.source &&
          e.id !== edge.id &&
          !shouldSkipEdge(e) &&
          nodes.value.find((n) => n.id === e.target)?.type !== undefined &&
          isSchemaType(nodes.value.find((n) => n.id === e.target)?.type)
      )
      if (!hasRemainingSchemaConnection) {
        updateNodeData(edge.source, {
          outputPortConnected: false,
        } as Partial<CustomNodeData>)
      }
    }
  }

  // ========================================================================
  // reconcileAll
  // ========================================================================

  /**
   * 从现有 edges 重建所有 parent/children/outputPortConnected 状态。
   * 幂等操作，可安全重复调用。
   *
   * 典型使用场景：V2 导入完成后。
   *
   * 实现方式：收集所有补丁后通过 **单次** `nodes.value` 替换统一应用，
   * 避免多次数组替换与 Vue Flow v-model:nodes 的异步回写产生竞态。
   */
  function reconcileAll() {
    logger.debug('[ConnectionStateSync] reconcileAll: 开始重建节点关系状态')

    // 收集所有需要应用的补丁: nodeId → accumulated patches
    const dataPatches = new Map<string, Record<string, unknown>>()

    // 阶段 1：清除所有节点的关系状态字段（仅对需要清除的字段生成补丁）
    for (const node of nodes.value) {
      const data = node.data as unknown as Record<string, unknown>
      const clearPatch: Record<string, unknown> = {}
      let needsClear = false

      if (isChildrenCapableType(node.type) && data.children !== undefined) {
        clearPatch.children = undefined
        needsClear = true
      }
      if (isParentCapableType(node.type) && data.parent !== undefined) {
        clearPatch.parent = undefined
        needsClear = true
      }
      if (isDataSourceType(node.type) && data.outputPortConnected !== false) {
        clearPatch.outputPortConnected = false
        needsClear = true
      }

      if (needsClear) {
        dataPatches.set(node.id, clearPatch)
      }
    }

    // 阶段 2：从 edges 重建关系 — 用 childrenMap 累积 children 数组
    const childrenMap = new Map<string, string[]>()

    for (const edge of edges.value) {
      if (shouldSkipEdge(edge)) continue

      const sourceNode = nodes.value.find((n) => n.id === edge.source)
      const targetNode = nodes.value.find((n) => n.id === edge.target)
      if (!sourceNode || !targetNode) continue

      // 累积 source.children
      if (isChildrenCapableType(sourceNode.type)) {
        const current = childrenMap.get(sourceNode.id) || []
        if (!current.includes(edge.target)) {
          current.push(edge.target)
          childrenMap.set(sourceNode.id, current)
        }
      }

      // 设置 target.parent（后续 edge 覆盖前面的）
      if (isParentCapableType(targetNode.type)) {
        const p = dataPatches.get(targetNode.id) || {}
        p.parent = edge.source
        dataPatches.set(targetNode.id, p)
      }

      // 设置 outputPortConnected
      if (isDataSourceType(sourceNode.type) && isSchemaType(targetNode.type)) {
        const p = dataPatches.get(sourceNode.id) || {}
        p.outputPortConnected = true
        dataPatches.set(sourceNode.id, p)
      }
    }

    // 将 childrenMap 合并到 dataPatches（覆盖阶段 1 的清除值）
    for (const [nodeId, children] of childrenMap) {
      const p = dataPatches.get(nodeId) || {}
      p.children = children
      dataPatches.set(nodeId, p)
    }

    // 单次批量更新 — 只做一次 nodes.value 替换
    if (dataPatches.size === 0) {
      logger.debug('[ConnectionStateSync] reconcileAll: 无需更新')
      return
    }

    nodes.value = nodes.value.map((node) => {
      const patch = dataPatches.get(node.id)
      if (!patch) return node
      return { ...node, data: { ...node.data, ...patch } } as CustomNode
    })

    logger.debug('[ConnectionStateSync] reconcileAll: 完成')
  }

  return {
    syncOnConnect,
    syncOnDisconnect,
    reconcileAll,
  }
}

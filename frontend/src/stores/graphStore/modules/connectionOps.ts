/**
 * @file connectionOps.ts
 * @description 画布连接操作模块 - 管理节点之间的连接关系
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. createConnection: 在两个节点之间创建新的连接
 * 2. deleteConnection: 删除指定的连接
 * 3. handleEdgeRemoved: 处理连接被移除时的清理逻辑
 *
 * ====================================================================
 * 连接类型说明
 * ====================================================================
 * 画布中存在以下类型的连接：
 * - SourcePreview → Schema: 数据源到表结构的连接
 * - Schema → Regex: 表结构到正则的连接（列级）
 * - Schema → Constraint: 表结构到约束的连接
 * - JsonSourcePreview → JsonSchema: JSON 数据源到 JSON Schema
 * - JsonSchema → Regex: JSON Schema 到正则
 * - JsonSchema → Constraint: JSON Schema 到约束
 *
 * ====================================================================
 * 连接数据结构
 * ====================================================================
 * 每条边（Edge）包含：
 * - id: 唯一标识符
 * - source: 源节点 ID
 * - target: 目标节点 ID
 * - sourceHandle: 源连接点 ID（如 'source-right-columnId'）
 * - targetHandle: 目标连接点 ID（如 'target-left', 'regex-input'）
 * - type: 边的类型（如 'smoothstep'）
 * - animated: 是否显示动画
 * - data: 附加数据（如 transient 标记）
 *
 * ====================================================================
 * handleEdgeRemoved 清理逻辑
 * ====================================================================
 * 当连接被移除时，需要清理相关的引用关系：
 *
 * 【SourcePreview → Schema】
 * - 清理 SourcePreview.children 数组
 * - 清理 Schema 的验证错误
 *
 * 【Schema/JsonSchema → Regex】
 * - 清理父节点的 children 数组
 * - 清理 Regex.parent 引用
 * - 重置 Regex 节点的 sourceRef、sourceNodeId、sourceColumnName
 * - 重置 saveState 为 'draft'
 *
 * 【Schema/JsonSchema → Constraint】
 * - 清理父节点的 children 数组
 * - 清理 Constraint.parent 引用
 * - 调用 buildDisconnectReset 重置约束特定字段
 *
 * 【ConditionalConstraint 特殊处理】
 * - 处理 if/then 连接断开时的逻辑
 * - 清理 ifConditions 中的引用
 * - 保留至少一个空条件防止数组为空
 *
 * ====================================================================
 * 架构设计
 * ====================================================================
 * - 使用 UUID 生成边 ID
 * - 依赖注入获取响应式状态
 * - 使用 validationRegistry 获取约束类型判断逻辑
 *
 * ====================================================================
 * transient 连接标记
 * ====================================================================
 * - transient 标记的边在删除时跳过清理逻辑
 * - 用于临时创建的连接（如拖拽过程中的预览连接）
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - 创建连接会修改 edges 数组
 * - 删除连接会清理相关的节点数据
 * - 可能触发验证状态的更新
 *
 * @module graphStore/modules
 */

import { logger } from '@/core/utils/logger'
import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { v4 as uuidv4 } from 'uuid'
import type {
  ConditionalConstraintNodeData,
  CustomNode,
  CustomNodeData,
  RegexNodeData,
} from '@/types/graph'
import {
  buildDisconnectReset,
  isConstraintNodeType,
} from '@/services/constraints/validationRegistry'

export function createConnectionOpsModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
  clearAllValidationErrors: (schemaNodeId: string) => void
}) {
  const { nodes, edges, updateNodeData, clearAllValidationErrors } = params

  function createConnection(
    sourceNodeId: string,
    targetNodeId: string,
    sourceHandle?: string,
    targetHandle?: string,
    options?: Partial<Edge>
  ) {
    logger.debug('🔄 graphStore.createConnection:', {
      sourceNodeId,
      targetNodeId,
      sourceHandle,
      targetHandle,
      options,
    })

    const newEdge: Edge = {
      id: uuidv4(),
      source: sourceNodeId,
      target: targetNodeId,
      sourceHandle,
      targetHandle,
      ...options,
    }

    edges.value = [...edges.value, newEdge]
    logger.debug('✅ 连接创建成功，当前边数量:', edges.value.length)
    return newEdge.id
  }

  function deleteConnection(edgeId: string) {
    const edge = edges.value.find((e) => e.id === edgeId)

    if (edge) {
      const targetNode = nodes.value.find((n) => n.id === edge.target)
      if (targetNode && targetNode.type === 'schema') {
        const isSourceConnection =
          edge.targetHandle === 'target-left' || edge.targetHandle === undefined
        const sourceNode = nodes.value.find((n) => n.id === edge.source)
        const isFromSourcePreview = sourceNode && sourceNode.type === 'sourcePreview'

        if (isSourceConnection && isFromSourcePreview) {
          clearAllValidationErrors(edge.target)
        }
      }
    }

    edges.value = edges.value.filter((e) => e.id !== edgeId)
  }

  function handleEdgeRemoved(edge: Edge) {
    if (
      (edge as unknown as Record<string, unknown>)?.data &&
      ((edge as unknown as Record<string, unknown>).data as Record<string, unknown>)?.transient
    )
      return

    // 清理父子关系属性
    const sourceNode = nodes.value.find((n) => n.id === edge.source)
    const targetNode = nodes.value.find((n) => n.id === edge.target)

    // SourcePreview → Schema 连接：清理 SourcePreview.children
    if (sourceNode?.type === 'sourcePreview' && targetNode?.type === 'schema') {
      const sourceData = sourceNode.data as unknown as Record<string, unknown>
      if (sourceData?.children) {
        const newChildren = (sourceData.children as string[]).filter((id) => id !== edge.target)
        updateNodeData(edge.source, { children: newChildren.length > 0 ? newChildren : undefined })
      }
    }

    // Schema → Regex 连接：清理 Schema.children 和 Regex.parent
    if (sourceNode?.type === 'schema' && targetNode?.type === 'regex') {
      // 清理 Schema 的 children
      const sourceData = sourceNode.data as unknown as Record<string, unknown>
      if (sourceData?.children) {
        const newChildren = (sourceData.children as string[]).filter((id) => id !== edge.target)
        updateNodeData(edge.source, { children: newChildren.length > 0 ? newChildren : undefined })
      }
      // 清理 Regex 的 parent
      const targetData = targetNode.data as unknown as Record<string, unknown>
      if ((targetData as Record<string, unknown> | undefined)?.parent === edge.source) {
        updateNodeData(edge.target, { parent: undefined })
      }
    }

    // Schema → Constraint 连接：清理 Schema.children 和 Constraint.parent
    if (sourceNode?.type === 'schema' && isConstraintNodeType(targetNode?.type)) {
      // 清理 Schema 的 children
      const sourceData = sourceNode.data as unknown as Record<string, unknown>
      if (sourceData?.children) {
        const newChildren = (sourceData.children as string[]).filter((id) => id !== edge.target)
        updateNodeData(edge.source, { children: newChildren.length > 0 ? newChildren : undefined })
      }
      // 清理 Constraint 的 parent
      const targetData = targetNode.data as unknown as Record<string, unknown>
      if (targetData?.parent === edge.source) {
        updateNodeData(edge.target, { parent: undefined })
      }
    }

    // JsonSourcePreview → JsonSchema 连接：清理 JsonSourcePreview.children
    if (sourceNode?.type === 'jsonSourcePreview' && targetNode?.type === 'jsonSchema') {
      const sourceData = sourceNode.data as unknown as Record<string, unknown>
      const currentChildren = (sourceData.children as string[]) || []
      const newChildren = currentChildren.filter((id) => id !== edge.target)
      updateNodeData(edge.source, {
        children: newChildren.length > 0 ? newChildren : undefined,
        outputPortConnected: false,
      })
    }

    // JsonSchema → Regex 连接：清理 JsonSchema.children 和 Regex.parent
    if (sourceNode?.type === 'jsonSchema' && targetNode?.type === 'regex') {
      // 清理 JsonSchema 的 children
      const sourceData = sourceNode.data as unknown as Record<string, unknown>
      if (sourceData?.children) {
        const newChildren = (sourceData.children as string[]).filter((id) => id !== edge.target)
        updateNodeData(edge.source, { children: newChildren.length > 0 ? newChildren : undefined })
      }
      // 清理 Regex 的 parent
      const targetData = targetNode.data as unknown as Record<string, unknown>
      if (targetData?.parent === edge.source) {
        updateNodeData(edge.target, { parent: undefined })
      }
    }

    // JsonSchema → Constraint 连接：清理 JsonSchema.children 和 Constraint.parent
    if (sourceNode?.type === 'jsonSchema' && isConstraintNodeType(targetNode?.type)) {
      // 清理 JsonSchema 的 children
      const sourceData = sourceNode.data as unknown as Record<string, unknown>
      if (sourceData?.children) {
        const newChildren = (sourceData.children as string[]).filter((id) => id !== edge.target)
        updateNodeData(edge.source, { children: newChildren.length > 0 ? newChildren : undefined })
      }
      // 清理 Constraint 的 parent
      const targetData = targetNode.data as unknown as Record<string, unknown>
      if (targetData?.parent === edge.source) {
        updateNodeData(edge.target, { parent: undefined })
      }
    }

    if (!targetNode) return

    if (targetNode.type === 'schema') {
      const isSourceConnection =
        edge.targetHandle === 'target-left' || edge.targetHandle === undefined
      const sourceNode = nodes.value.find((n) => n.id === edge.source)
      const isFromSourcePreview = sourceNode && sourceNode.type === 'sourcePreview'
      if (isSourceConnection && isFromSourcePreview) {
        clearAllValidationErrors(edge.target)
      }
    }

    if (targetNode.type === 'conditionalConstraint') {
      const data = targetNode.data as ConditionalConstraintNodeData
      const targetHandle = edge.targetHandle || ''
      const isIf = targetHandle.startsWith(`target-if-${targetNode.id}`)
      const isThen =
        targetHandle === `target-then-${targetNode.id}` ||
        targetHandle === `target-input-${targetNode.id}`

      const parseColumnId = (handle?: string) => {
        if (!handle) return undefined
        return handle.startsWith('source-right-') ? handle.replace('source-right-', '') : handle
      }

      if (isIf) {
        const removedColumnId = parseColumnId(edge.sourceHandle)
        const removedNodeId = edge.source

        const baseConditions =
          Array.isArray(data.ifConditions) && data.ifConditions.length > 0
            ? data.ifConditions.slice()
            : [
                {
                  operator: 'eq' as const,
                  value: data.ifValue || '',
                  column: data.ifColumn || '',
                  ref: data.ifRef
                    ? { nodeId: data.ifRef.nodeId, columnId: data.ifRef.columnId }
                    : undefined,
                },
              ]

        const nextConditions = baseConditions.filter((c) => {
          if (
            (c as Record<string, unknown>).edgeId &&
            (c as Record<string, unknown>).edgeId === edge.id
          )
            return false
          if (
            removedColumnId &&
            c.ref?.nodeId === removedNodeId &&
            c.ref?.columnId === removedColumnId
          )
            return false
          return true
        })

        const safeConditions =
          nextConditions.length > 0 ? nextConditions : [{ operator: 'eq' as const, value: '' }]
        const first = safeConditions[0] as {
          ref?: { nodeId: string; columnId: string }
          column?: string
          value?: string
        }

        updateNodeData(targetNode.id, {
          ...data,
          ifConditions: safeConditions,
          ifLogic: data.ifLogic || 'and',
          ifRef: first?.ref,
          ifColumn: first?.column || '',
          ifValue: typeof first?.value === 'string' ? first.value : '',
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
        })
        return
      }

      if (isThen) {
        updateNodeData(targetNode.id, {
          ...data,
          thenRef: undefined,
          thenColumn: '',
          validationStatus: 'idle',
          validationErrors: [],
          lastValidation: undefined,
        })
        return
      }
    }

    if (targetNode.type === 'regex') {
      const sourceNode = nodes.value.find((n) => n.id === edge.source)
      if (!sourceNode || (sourceNode.type !== 'schema' && sourceNode.type !== 'transformOutput'))
        return

      const data = targetNode.data as RegexNodeData
      updateNodeData(targetNode.id, {
        ...data,
        sourceNodeId: undefined,
        sourceColumnName: undefined,
        sourceRef: undefined,
        saveState: 'draft',
        validationStatus: 'idle',
        errorCount: undefined,
        totalRows: undefined,
        matchCount: undefined,
        lastValidationTime: undefined,
      })
      return
    }

    if (isConstraintNodeType(targetNode.type)) {
      const data = (targetNode.data || {}) as unknown as Record<string, unknown>
      updateNodeData(targetNode.id, {
        ...buildDisconnectReset(targetNode.type, data),
        sourceRef: undefined,
        table: targetNode.type === 'scriptedConstraint' ? String(data.table || '') : '',
        column: targetNode.type === 'scriptedConstraint' ? undefined : '',
        saveState: 'draft',
      })
      return
    }

    if (targetNode.type === 'transform') {
      updateNodeData(targetNode.id, {
        inputFromNode: undefined,
        inputColumn: undefined,
        saveState: 'draft',
      })
      return
    }
  }

  return {
    createConnection,
    deleteConnection,
    handleEdgeRemoved,
  }
}

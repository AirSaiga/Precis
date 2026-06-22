/**
 * @file schemaOps.ts
 * @description Schema 节点操作模块 - 管理和操作 Schema 节点及其关联的边
 *
 * ====================================================================
 * 功能概述
 * ====================================================================
 * 1. bindRegexToSchemaColumn: 将正则节点绑定到 Schema 的特定列
 * 2. addConstraintToColumn: 为列添加约束标记（notNull/unique）
 * 3. removeConstraintFromColumn: 移除列的约束标记
 * 4. hasColumnConstraint: 检查列是否有特定约束
 * 5. clearColumnValidationErrors: 清除单列的验证错误
 * 6. clearAllValidationErrors: 清除所有列的验证错误
 *
 * ====================================================================
 * bindRegexToSchemaColumn 核心逻辑
 * ====================================================================
 * - 在 Schema 节点和 Regex 节点之间建立连接
 * - 使用 sourceHandle 标识具体的列（格式: source-right-{columnId}）
 * - 自动清理该 Regex 节点的其他入边（只允许一个 Schema 来源）
 * - 更新 Regex 节点的 sourceRef、sourceNodeId、sourceColumnName
 * - 维护 Schema 节点的 children 数组（用于级联保存）
 *
 * ====================================================================
 * 连接边样式
 * ====================================================================
 * Schema → Regex 连接使用以下样式：
 * - type: 'smoothstep'
 * - animated: true（显示数据流动动画）
 * - stroke: 'var(--edge-schema-to-regex)'
 * - strokeWidth: 2
 *
 * ====================================================================
 * 约束标记系统
 * ====================================================================
 * - 列约束存储在 column.constraints 对象中
 * - notNull: 非空约束
 * - unique: 唯一性约束
 * - 约束标记仅用于 UI 展示，不影响实际校验逻辑
 *
 * ====================================================================
 * 验证错误清理
 * ====================================================================
 * - 验证错误存储在 column.validationErrors 数组中
 * - clearColumnValidationErrors: 只清除指定列的错误
 * - clearAllValidationErrors: 清除所有列的错误
 * - 用于数据源变更时重置验证状态
 *
 * ====================================================================
 * 副作用说明
 * ====================================================================
 * - 修改 edges 数组（添加/删除边）
 * - 更新 Schema 节点的 children 数组
 * - 更新 Regex/Constraint 节点的 sourceRef
 * - 更新 Schema 节点的 columns 数组
 *
 * @module graphStore/modules
 */

import type { Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData, SchemaNodeData, JsonSchemaNodeData } from '@/types/graph'
import { addEdges, removeEdges } from '@/services/canvas/vueFlowApi'
import {
  findJsonSchemaColumnById,
  updateJsonSchemaColumnsRecursive,
} from '@/utils/nodes/json/columnFinder'
export function createSchemaOpsModule(params: {
  nodes: Ref<CustomNode[]>
  edges: Ref<Edge[]>
  updateNodeData: (nodeId: string, newData: Partial<CustomNodeData>) => void
  syncOnConnect: (sourceId: string, targetId: string) => void
}) {
  const { nodes, edges, updateNodeData, syncOnConnect } = params

  function bindRegexToSchemaColumn(schemaNodeId: string, columnId: string, regexNodeId: string) {
    const schemaNode = nodes.value.find(
      (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
    )
    const regexNode = nodes.value.find((n) => n.id === regexNodeId && n.type === 'regex')
    if (!schemaNode || !regexNode) return false

    const schemaData = schemaNode.data as SchemaNodeData | JsonSchemaNodeData
    let columnName = ''
    if (schemaNode.type === 'jsonSchema') {
      const found = findJsonSchemaColumnById((schemaData as JsonSchemaNodeData).columns, columnId)
      columnName = found?.column.columnName || ''
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
      columnName =
        (schemaData as SchemaNodeData).columns.find((c) => c.id === columnId)?.columnName || ''
    }

    // 先通过 API 删除该 Regex 节点的旧入边（触发 onEdgesChange 清理链）
    const oldEdges = edges.value.filter(
      (e) => e.target === regexNodeId && (e.targetHandle as string | undefined) === 'regex-input'
    )
    for (const edge of oldEdges) {
      removeEdges(edge.id)
    }

    const edgeId = `e-${schemaNodeId}-${regexNodeId}-${columnId}`
    if (!edges.value.some((e) => e.id === edgeId)) {
      addEdges({
        id: edgeId,
        source: schemaNodeId,
        target: regexNodeId,
        sourceHandle: `source-right-${columnId}`,
        targetHandle: 'regex-input',
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'var(--edge-schema-to-regex)', strokeWidth: 2 },
      } as Edge)
    }

    // 更新 Regex 节点的 sourceRef
    updateNodeData(regexNodeId, {
      sourceRef: { nodeId: schemaNodeId, columnId },
      saveState: 'draft',
    } as unknown as Record<string, unknown>)

    // 统一更新 children/parent 关系状态
    syncOnConnect(schemaNodeId, regexNodeId)

    return true
  }

  function addConstraintToColumn(
    schemaNodeId: string,
    columnId: string,
    constraintType: 'notNull' | 'unique'
  ) {
    const node = nodes.value.find((n) => n.id === schemaNodeId)
    if (!node) return

    if (node.type === 'schema') {
      const schemaData = node.data as SchemaNodeData
      const updatedColumns = schemaData.columns.map((column) => {
        if (column.id === columnId) {
          return {
            ...column,
            constraints: {
              ...column.constraints,
              [constraintType]: true,
            },
          }
        }
        return column
      })
      updateNodeData(schemaNodeId, {
        ...schemaData,
        columns: updatedColumns,
      })
    } else if (node.type === 'jsonSchema') {
      const schemaData = node.data as JsonSchemaNodeData
      const updatedColumns = updateJsonSchemaColumnsRecursive(schemaData.columns, (column) => {
        if (column.id === columnId) {
          return {
            ...column,
            constraints: {
              ...column.constraints,
              [constraintType]: true,
            },
          }
        }
        return column
      })
      updateNodeData(schemaNodeId, {
        ...schemaData,
        columns: updatedColumns,
      })
    }
  }

  function removeConstraintFromColumn(
    schemaNodeId: string,
    columnId: string,
    constraintType: 'notNull' | 'unique'
  ) {
    const node = nodes.value.find((n) => n.id === schemaNodeId)
    if (!node) return

    if (node.type === 'schema') {
      const schemaData = node.data as SchemaNodeData
      const updatedColumns = schemaData.columns.map((column) => {
        if (column.id === columnId && column.constraints) {
          // 使用解构剔除模式替代 as unknown as + delete，保持类型安全
          const { [constraintType]: _removed, ...rest } = column.constraints as Record<
            string,
            boolean
          >
          return {
            ...column,
            constraints: Object.keys(rest).length > 0 ? rest : undefined,
          }
        }
        return column
      })
      updateNodeData(schemaNodeId, {
        ...schemaData,
        columns: updatedColumns,
      })
    } else if (node.type === 'jsonSchema') {
      const schemaData = node.data as JsonSchemaNodeData
      const updatedColumns = updateJsonSchemaColumnsRecursive(schemaData.columns, (column) => {
        if (column.id === columnId && column.constraints) {
          // 使用解构剔除模式替代 as unknown as + delete，保持类型安全
          const { [constraintType]: _removed, ...rest } = column.constraints as Record<
            string,
            boolean
          >
          return {
            ...column,
            constraints: Object.keys(rest).length > 0 ? rest : undefined,
          }
        }
        return column
      })
      updateNodeData(schemaNodeId, {
        ...schemaData,
        columns: updatedColumns,
      })
    }
  }

  function hasColumnConstraint(
    schemaNodeId: string,
    columnId: string,
    constraintType: 'notNull' | 'unique'
  ): boolean {
    const node = nodes.value.find((n) => n.id === schemaNodeId)
    if (!node) return false

    if (node.type === 'schema') {
      const schemaData = node.data as SchemaNodeData
      const column = schemaData.columns.find((col) => col.id === columnId)
      return column?.constraints?.[constraintType] === true
    } else if (node.type === 'jsonSchema') {
      const schemaData = node.data as JsonSchemaNodeData
      const found = findJsonSchemaColumnById(schemaData.columns, columnId)
      return found?.column.constraints?.[constraintType] === true
    }
    return false
  }

  function clearColumnValidationErrors(schemaNodeId: string, columnId: string): void {
    const node = nodes.value.find((n) => n.id === schemaNodeId)
    if (!node || (node.type !== 'schema' && node.type !== 'jsonSchema')) {
      return
    }

    if (node.type === 'schema') {
      const schemaData = node.data as SchemaNodeData
      const updatedColumns = schemaData.columns.map((col) => {
        if (col.id === columnId) {
          return {
            ...col,
            validationErrors: [],
          }
        }
        return col
      })
      updateNodeData(schemaNodeId, {
        ...schemaData,
        columns: updatedColumns,
      })
    } else {
      const schemaData = node.data as JsonSchemaNodeData
      const updatedColumns = updateJsonSchemaColumnsRecursive(schemaData.columns, (col) => {
        if (col.id === columnId) {
          return {
            ...col,
            validationErrors: [],
          }
        }
        return col
      })
      updateNodeData(schemaNodeId, {
        ...schemaData,
        columns: updatedColumns,
      })
    }
  }

  function clearAllValidationErrors(schemaNodeId: string): void {
    const node = nodes.value.find((n) => n.id === schemaNodeId)
    if (!node || (node.type !== 'schema' && node.type !== 'jsonSchema')) {
      return
    }

    if (node.type === 'schema') {
      const schemaData = node.data as SchemaNodeData
      const updatedColumns = schemaData.columns.map((col) => ({
        ...col,
        validationErrors: [],
      }))
      updateNodeData(schemaNodeId, {
        ...schemaData,
        columns: updatedColumns,
      })
    } else {
      const schemaData = node.data as JsonSchemaNodeData
      const updatedColumns = updateJsonSchemaColumnsRecursive(schemaData.columns, (col) => ({
        ...col,
        validationErrors: [],
      }))
      updateNodeData(schemaNodeId, {
        ...schemaData,
        columns: updatedColumns,
      })
    }
  }

  return {
    bindRegexToSchemaColumn,
    addConstraintToColumn,
    removeConstraintFromColumn,
    hasColumnConstraint,
    clearColumnValidationErrors,
    clearAllValidationErrors,
  }
}

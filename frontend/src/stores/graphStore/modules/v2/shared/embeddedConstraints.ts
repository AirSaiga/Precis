/**
 * @file embeddedConstraints.ts
 * @description V2 内嵌约束物化模块
 *
 * 将 schema.yaml 中内嵌的 constraints 字段物化为画布上的 Constraint 节点和边。
 * 内嵌约束是 V2 配置中直接写在 schema 文件里的约束定义，与独立 constraint 文件不同。
 *
 * 功能概述：
 * - materializeV2EmbeddedConstraints: 主入口，遍历 schema 的 embeddedConstraints
 * - 按约束类型创建对应的 Constraint 节点（NotNull、Unique、AllowedValues 等）
 * - 自动建立 Constraint 节点到 Schema 列的边
 * - 去重检查：避免创建重复的约束节点
 *
 * 架构设计：
 * - 纯函数设计，接收 schemaNode + 工具函数作为参数
 * - 通过 colNameToId 映射将约束中的列名转为列 ID
 * - 使用 hasNode / addNode / addConstraintEdge 回调与外部状态交互
 */

import type { CustomNode } from '@/types/graph'

interface EmbeddedConstraintItem {
  id?: string | number
  type?: string
  column?: string
  description?: string
  params?: {
    allowed_values?: unknown[]
    min?: unknown
    max?: unknown
  }
}

export function materializeV2EmbeddedConstraints(params: {
  schemaNode: CustomNode
  schemaTableName: string
  embeddedConstraints: EmbeddedConstraintItem[]
  colNameToId: Map<string, string>
  hasNode: (id: string) => boolean
  addNode: (node: CustomNode) => void
  addConstraintEdge: (tableId: string, constraintId: string, columnId: string) => void
}) {
  const {
    schemaNode,
    schemaTableName,
    embeddedConstraints,
    colNameToId,
    hasNode,
    addNode,
    addConstraintEdge,
  } = params

  const typeMap: Record<string, string> = {
    Unique: 'uniqueConstraint',
    NotNull: 'notNullConstraint',
    AllowedValues: 'allowedValuesConstraint',
    ForeignKey: 'foreignKeyConstraint',
    Range: 'rangeConstraint',
    Conditional: 'conditionalConstraint',
    Scripted: 'scriptedConstraint',
    Charset: 'charsetConstraint',
    DateLogic: 'dateLogicConstraint',
  }

  embeddedConstraints.forEach((item: EmbeddedConstraintItem, idx: number) => {
    if (!item?.id) return

    // 使用与 ResourceService 一致的 ID 生成逻辑（SchemaId_ConstraintId）
    // 防止与独立约束或其他 Schema 的约束 ID 冲突
    // 如果 item.id 已经包含 schemaTableName 前缀，则不再拼接（防御性编程）
    const rawId = String(item.id)
    const id = rawId.startsWith(`${schemaNode.id}_`) ? rawId : `${schemaNode.id}_${rawId}`

    if (hasNode(id)) return

    const nodeType = typeMap[item.type] || 'constraint'
    const basePos = { x: schemaNode.position.x + 420, y: schemaNode.position.y + idx * 160 }

    if (item.type === 'AllowedValues') {
      const colId = item.column ? colNameToId.get(String(item.column)) : undefined
      addNode({
        id,
        type: nodeType,
        position: basePos,
        data: {
          embedded: true,
          configName: item.description || id,
          table: schemaTableName,
          column: String(item.column || ''),
          allowedValues: new Set((item.params?.allowed_values || []) as string[]),
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: colId ? { nodeId: schemaNode.id, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNode['data'],
      })
      if (colId) addConstraintEdge(schemaNode.id, id, colId)
      return
    }

    if (item.type === 'NotNull') {
      const colId = item.column ? colNameToId.get(String(item.column)) : undefined
      addNode({
        id,
        type: nodeType,
        position: basePos,
        data: {
          embedded: true,
          configName: item.description || id,
          table: schemaTableName,
          column: String(item.column || ''),
          validationErrors: [],
          sourceRef: colId ? { nodeId: schemaNode.id, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNode['data'],
      })
      if (colId) addConstraintEdge(schemaNode.id, id, colId)
      return
    }

    if (item.type === 'Unique') {
      // 单一约束只取第一列
      const colName = item.column ? String(item.column) : ''
      const colId = colName ? colNameToId.get(colName) : undefined
      addNode({
        id,
        type: nodeType,
        position: basePos,
        data: {
          embedded: true,
          configName: item.description || id,
          table: schemaTableName,
          column: colName,
          validationErrors: [],
          sourceRef: colId ? { nodeId: schemaNode.id, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNode['data'],
      })
      if (colId) addConstraintEdge(schemaNode.id, id, colId)
      return
    }

    if (item.type === 'Range') {
      const colId = item.column ? colNameToId.get(String(item.column)) : undefined
      addNode({
        id,
        type: nodeType,
        position: basePos,
        data: {
          embedded: true,
          configName: item.description || id,
          table: schemaTableName,
          column: String(item.column || ''),
          minValue: (item.params || {}).min,
          maxValue: (item.params || {}).max,
          validationStatus: 'idle',
          validationErrors: [],
          sourceRef: colId ? { nodeId: schemaNode.id, columnId: colId } : undefined,
          saveState: 'saved',
        } as unknown as CustomNode['data'],
      })
      if (colId) addConstraintEdge(schemaNode.id, id, colId)
      return
    }

    addNode({
      id,
      type: nodeType,
      position: basePos,
      data: {
        embedded: true,
        configName: item.description || id,
        saveState: 'saved',
      } as unknown as CustomNode['data'],
    })
  })
}

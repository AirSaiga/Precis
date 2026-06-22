/**
 * @file embeddedConstraints.ts
 * @description V2 内嵌约束物化模块
 *
 * 将 schema.yaml 中内嵌的 constraints 字段物化为画布上的 Constraint 节点和边。
 * 通过 NodeDataBuilder 统一构建节点数据，确保与独立约束导入路径一致。
 *
 * 功能概述：
 * - materializeV2EmbeddedConstraints: 主入口，遍历 schema 的 embeddedConstraints
 * - 按约束类型通过 buildNodeData 创建对应的 Constraint 节点
 * - 自动建立 Constraint 节点到 Schema 列的边
 * - 去重检查：避免创建重复的约束节点
 *
 * 架构设计：
 * - 纯函数设计，接收 schemaNode + 工具函数作为参数
 * - 通过 colNameToId 映射将约束中的列名转为列 ID
 * - 使用 hasNode / addNode / addConstraintEdge 回调与外部状态交互
 */

import type { CustomNode } from '@/types/graph'
import {
  getConstraintKindByV2Type,
  getConstraintNodeTypeByV2Type,
} from '@/services/constraints/validationRegistry'
import type { BuildInput } from '@/services/constraints/nodeDataBuilder'
import { buildNodeData } from '@/services/constraints/nodeDataBuilder'
interface EmbeddedConstraintItem {
  id?: string | number
  type?: string
  column?: string
  description?: string
  params?: {
    allowed_values?: unknown[]
    min?: unknown
    max?: unknown
    expression?: unknown
    name?: unknown
    charset_mode?: unknown
    allowed_chars?: unknown
    disallowed_chars?: unknown
    logic_mode?: unknown
    start_date?: unknown
    end_date?: unknown
    date_format?: unknown
    [key: string]: unknown
  }
  // Conditional 内嵌约束的 refs 字段
  refs?: {
    if_conditions?: unknown[]
    if_logic?: string
    then_column_id?: string
    [key: string]: unknown
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

  embeddedConstraints.forEach((item: EmbeddedConstraintItem, idx: number) => {
    if (!item?.id) return

    const rawId = String(item.id)
    const id = rawId.startsWith(`${schemaNode.id}_`) ? rawId : `${schemaNode.id}_${rawId}`

    if (hasNode(id)) return

    const nodeType = getConstraintNodeTypeByV2Type(item.type ?? '') ?? 'constraint'
    const basePos = { x: schemaNode.position.x + 420, y: schemaNode.position.y + idx * 160 }
    const kind = getConstraintKindByV2Type(item.type ?? '')

    // 解析列 ID
    const colName = item.column ? String(item.column) : ''
    const colId = colName ? colNameToId.get(colName) : undefined

    // 构建 BuildInput
    let buildInput: BuildInput

    if (item.type === 'Conditional') {
      // Conditional 内嵌约束 — 解析 IF 条件和 THEN 列
      // 优先从 params 读取（与 schemaBuilder 导出格式一致），兼容旧版 refs
      const itemParams = (item.params || {}) as Record<string, unknown>
      const itemRefs = (item.refs || itemParams) as Record<string, unknown>
      const ifLogic = String(itemRefs.if_logic || itemParams.if_logic || 'and')
      const thenColName =
        itemRefs.then_column_id || itemParams.then_column_id
          ? String(itemRefs.then_column_id || itemParams.then_column_id)
          : ''
      const thenColId = thenColName ? colNameToId.get(thenColName) : undefined

      const rawConditions = Array.isArray(itemRefs.if_conditions || itemParams.if_conditions)
        ? ((itemRefs.if_conditions || itemParams.if_conditions) as unknown[])
        : []
      const ifConditions = rawConditions.map((cond) => {
        const r = cond as Record<string, unknown>
        const ifColName = String(r?.if_column_id || '')
        const ifColId = ifColName ? colNameToId.get(ifColName) : undefined
        return {
          operator: String(r?.operator ?? ''),
          value: r?.value,
          values: r?.values as unknown[] | undefined,
          columnId: ifColId || '',
          columnName: ifColName,
        }
      })

      buildInput = {
        mode: 'embedded',
        configName: item.description || id,
        schemaNodeId: schemaNode.id,
        tableName: schemaTableName,
        nodeId: id,
        nodeType,
        embedded: true,
        ifConditions,
        ifLogic,
        thenRef: thenColId
          ? { nodeId: schemaNode.id, columnId: thenColId, columnName: thenColName }
          : undefined,
        thenConditionConfig: itemParams.then_condition,
        params: item.params as Record<string, unknown> | undefined,
      }
    } else {
      // 通用单列约束
      buildInput = {
        mode: 'embedded',
        configName: item.description || id,
        schemaNodeId: schemaNode.id,
        tableName: schemaTableName,
        nodeId: id,
        nodeType,
        embedded: true,
        columnRef: colId
          ? { nodeId: schemaNode.id, columnId: colId, columnName: colName }
          : undefined,
        params: item.params as Record<string, unknown> | undefined,
      }
    }

    // 使用 NodeDataBuilder 构建节点数据
    const result = kind
      ? buildNodeData(kind, buildInput)
      : {
          // 未知类型的降级
          nodeData: {
            embedded: true,
            configName: item.description || id,
            saveState: 'saved',
          } as Record<string, unknown>,
          edgeDescriptors: [] as Array<{
            kind: 'constraint'
            sourceNodeId: string
            targetNodeId: string
            columnId: string
          }>,
        }

    addNode({
      id,
      type: nodeType,
      position: basePos,
      data: result.nodeData as unknown as CustomNode['data'],
    })

    // 创建边
    for (const desc of result.edgeDescriptors) {
      if (desc.kind === 'constraint' || desc.kind === 'if') {
        addConstraintEdge(desc.sourceNodeId, desc.targetNodeId, desc.columnId)
      }
    }
  })
}

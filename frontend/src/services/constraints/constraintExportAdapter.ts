/**
 * @file constraintExportAdapter.ts
 * @description 约束节点导出适配器
 *
 * 将前端画布上的约束节点数据转换为后端 V2 配置格式（refs + params）。
 * 每种约束类型（NotNull、Unique、ForeignKey、Conditional 等）有独立的转换逻辑。
 *
 * 功能概述：
 * - resolveSchemaAndColumnIdByName: 根据表名/列名在画布节点中查找对应 ID
 * - buildConstraintExportPayload: 主入口，按约束类型分派到具体适配器
 * - 各类型适配器：将节点 data 转换为 backend ConstraintFileV2 格式
 *
 * 架构设计：
 * - 纯函数设计，无状态依赖，便于单元测试
 * - 通过 schemaIdByNodeId 映射解决 canvas UUID → schema ID 的转换
 * - 外键约束需要额外处理 targetRef 和 sourceInfo
 */

import type { CustomNode, SchemaNodeData } from '@/types/graph'
import type { ConstraintTypeV2 } from '@/types/projectV2'
import { generateSchemaId } from '@/utils/typeHelpers'

function resolveSchemaAndColumnIdByName(
  nodes: CustomNode[],
  tableName: string,
  columnName: string
): { tableId: string; columnId: string } | null {
  const schemaNode = nodes.find(
    (n) => n.type === 'schema' && (n.data as SchemaNodeData).tableName === tableName
  )
  if (!schemaNode) return null
  const schemaData = schemaNode.data as SchemaNodeData
  const col = schemaData.columns.find((c) => c.columnName === columnName)
  if (!col) return null
  const tableId = generateSchemaId(
    schemaData.sourceFilePath || schemaData.sourceFile || '',
    schemaData.sheetName
  )
  return { tableId, columnId: col.id }
}

export function buildConstraintExportPayload(params: {
  nodes: CustomNode[]
  constraintNodeId: string
  v2Type: ConstraintTypeV2
  data: any
  schemaIdByNodeId: Record<string, string>
}): { refs: Record<string, unknown>; params: Record<string, unknown> } {
  const { nodes, constraintNodeId, v2Type, data, schemaIdByNodeId } = params
  const refs: Record<string, unknown> = {}
  const outputParams: Record<string, unknown> = {}
  const normalizeSchemaId = (value?: string) => (value ? schemaIdByNodeId[value] || value : value)

  switch (v2Type) {
    case 'AllowedValues': {
      const sourceRef = data.sourceRef
      if (sourceRef?.nodeId && sourceRef?.columnId) {
        refs.table_id = normalizeSchemaId(sourceRef.nodeId)
        refs.column_id = sourceRef.columnId
      } else {
        const resolved = resolveSchemaAndColumnIdByName(nodes, data.table, data.column)
        if (resolved) {
          refs.table_id = resolved.tableId
          refs.column_id = resolved.columnId
        }
      }
      outputParams.allowed_values = Array.from(data.allowedValues || []).map((v: any) => String(v))
      break
    }
    case 'ForeignKey': {
      const sRef = data.sourceRef
      const tRef = data.targetRef
      if (sRef?.nodeId && sRef?.columnId && tRef?.nodeId && tRef?.columnId) {
        refs.from_table_id = normalizeSchemaId(sRef.nodeId)
        refs.from_column_id = sRef.columnId
        refs.to_table_id = normalizeSchemaId(tRef.nodeId)
        refs.to_column_id = tRef.columnId
      }
      break
    }
    case 'Unique': {
      const sourceRef = data.sourceRef
      if (sourceRef?.nodeId && sourceRef?.columnId) {
        refs.table_id = normalizeSchemaId(sourceRef.nodeId)
        refs.column_ids = [sourceRef.columnId]
      } else {
        const tableResolved = nodes.find(
          (n) => n.type === 'schema' && (n.data as SchemaNodeData).tableName === data.table
        )
        if (tableResolved) {
          refs.table_id = schemaIdByNodeId[tableResolved.id] || tableResolved.id
          const schemaData = tableResolved.data as SchemaNodeData
          const found = schemaData.columns.find((c) => c.columnName === data.column)
          if (found) refs.column_ids = [found.id]
        }
      }
      break
    }
    case 'NotNull':
    case 'Range':
    case 'Charset':
    case 'DateLogic': {
      const sourceRef = data.sourceRef
      if (sourceRef?.nodeId && sourceRef?.columnId) {
        refs.table_id = normalizeSchemaId(sourceRef.nodeId)
        refs.column_id = sourceRef.columnId
      } else {
        const resolved = resolveSchemaAndColumnIdByName(nodes, data.table, data.column)
        if (resolved) {
          refs.table_id = resolved.tableId
          refs.column_id = resolved.columnId
        }
      }
      if (v2Type === 'Range') {
        if (data.minValue !== undefined) outputParams.min = data.minValue
        if (data.maxValue !== undefined) outputParams.max = data.maxValue
        if (data.boundaryMode) outputParams.boundary_mode = data.boundaryMode
      }
      if (v2Type === 'Charset') {
        if (data.charsetMode) outputParams.charset_mode = data.charsetMode
        if (data.allowedChars) outputParams.allowed_chars = data.allowedChars
        if (data.disallowedChars) outputParams.disallowed_chars = data.disallowedChars
      }
      if (v2Type === 'DateLogic') {
        if (data.logicMode) outputParams.logic_mode = data.logicMode
        if (data.compareOp) outputParams.compare_op = data.compareOp
        if (data.referenceDate) outputParams.reference_date = data.referenceDate
        if (data.referenceColumn) outputParams.reference_column = data.referenceColumn
        if (data.calculationType) outputParams.calculation_type = data.calculationType
        if (data.targetValue !== undefined) outputParams.target_value = data.targetValue
        if (data.targetColumn) outputParams.target_column = data.targetColumn
      }
      break
    }
    case 'Conditional': {
      const thenRef = data.thenRef
      const ifRef = data.ifRef
      const firstCondRef = Array.isArray(data.ifConditions)
        ? data.ifConditions.find((c: any) => c?.ref?.nodeId)?.ref
        : undefined
      const schemaId = String(thenRef?.nodeId || ifRef?.nodeId || firstCondRef?.nodeId || '')
      if (schemaId) {
        refs.table_id = normalizeSchemaId(schemaId)
        const schemaNode = nodes.find((n) => n.id === schemaId && n.type === 'schema')
        const schemaData = schemaNode?.data as SchemaNodeData | undefined
        const resolveColumnNameById = (colId?: string) =>
          schemaData ? schemaData.columns.find((c) => c.id === colId)?.columnName || '' : ''
        const resolveColumnIdByName = (colName?: string) =>
          schemaData ? schemaData.columns.find((c) => c.columnName === colName)?.id : undefined
        const thenColumnId = thenRef?.columnId || resolveColumnIdByName(data.thenColumn)
        if (thenColumnId) refs.then_column_id = thenColumnId
        refs.if_logic = data.ifLogic || 'and'
        const ifConditions = Array.isArray(data.ifConditions) ? data.ifConditions : []
        refs.if_conditions = ifConditions
          .filter((cond: any) => cond?.operator)
          .map((cond: any) => ({
            if_column_id: String(
              cond?.ref?.columnId || ifRef?.columnId || resolveColumnIdByName(cond?.column) || ''
            ),
            operator: cond.operator,
            value: cond.value,
            values: cond.values,
          }))
          .filter((x: any) => !!x.if_column_id)
        if (!data.thenColumn && thenColumnId) {
          const resolved = resolveColumnNameById(thenColumnId)
          if (resolved) data.thenColumn = resolved
        }
      }
      outputParams.then_condition = data.thenConditionConfig
      break
    }
    case 'Scripted': {
      const schemaIdFromRef = data.sourceRef?.nodeId
      if (schemaIdFromRef) {
        refs.table_id = normalizeSchemaId(schemaIdFromRef)
        if (data.sourceRef?.columnId) refs.column_id = data.sourceRef.columnId
      } else {
        const schemaNode = nodes.find(
          (n) => n.type === 'schema' && (n.data as SchemaNodeData).tableName === data.table
        )
        if (schemaNode) refs.table_id = schemaIdByNodeId[schemaNode.id] || schemaNode.id
      }
      outputParams.name = data.constraintName || data.configName || constraintNodeId
      outputParams.expression = data.script || ''
      break
    }
    case 'Composite': {
      const sourceRef = data.sourceRef
      if (sourceRef?.nodeId && sourceRef?.columnId) {
        refs.table_id = normalizeSchemaId(sourceRef.nodeId)
        refs.column_id = sourceRef.columnId
      }
      outputParams.logic = data.logic || 'all'

      // 优先使用 includedNodeIds（引用主画布上的独立约束节点）
      const includedNodeIds: string[] = data.includedNodeIds || []
      if (includedNodeIds.length > 0) {
        outputParams.sub_constraints = includedNodeIds
          .map((nodeId: string) => {
            const subNode = nodes.find((n) => n.id === nodeId)
            if (!subNode || !subNode.type?.endsWith('Constraint')) return null
            const subData = (subNode.data || {}) as Record<string, unknown>
            const subV2Type = subNode.type.replace('Constraint', '')
            const subRefs: Record<string, unknown> = {}
            if ((subData as any).table) {
              const resolved = resolveSchemaAndColumnIdByName(
                nodes,
                (subData as any).table as string,
                ((subData as any).column as string) || ''
              )
              if (resolved) {
                subRefs.table_id = resolved.tableId
                subRefs.column_id = resolved.columnId
              }
            }
            if ((subData as any).sourceRef?.nodeId && (subData as any).sourceRef?.columnId) {
              subRefs.table_id = normalizeSchemaId((subData as any).sourceRef.nodeId)
              subRefs.column_id = (subData as any).sourceRef.columnId
            }
            return {
              id: subNode.id,
              type: subV2Type.charAt(0).toUpperCase() + subV2Type.slice(1),
              enabled: (subData as any).enabled !== false,
              description: (subData as any).configName || (subData as any).description || undefined,
              refs: subRefs,
              params: {},
            }
          })
          .filter(Boolean)
      } else {
        // 向后兼容：从 subGraph.nodes 导出
        const subNodes = data.subGraph?.nodes || []
        outputParams.sub_constraints = subNodes
          .filter((subNode: any) => subNode.type && subNode.type.endsWith('Constraint'))
          .map((subNode: any) => {
            const subData = subNode.data || {}
            const subV2Type = subNode.type.replace('Constraint', '')
            const subRefs: Record<string, unknown> = {}
            if (subData.table) {
              const resolved = resolveSchemaAndColumnIdByName(
                nodes,
                subData.table,
                subData.column || ''
              )
              if (resolved) {
                subRefs.table_id = resolved.tableId
                subRefs.column_id = resolved.columnId
              }
            }
            if (subData.sourceRef?.nodeId && subData.sourceRef?.columnId) {
              subRefs.table_id = normalizeSchemaId(subData.sourceRef.nodeId)
              subRefs.column_id = subData.sourceRef.columnId
            }
            return {
              id: subNode.id,
              type: subV2Type.charAt(0).toUpperCase() + subV2Type.slice(1),
              enabled: subData.enabled !== false,
              description: subData.configName || subData.description || undefined,
              refs: subRefs,
              params: {},
            }
          })
      }
      break
    }
    default: {
      // 穷尽检查：如果新增 ConstraintTypeV2 但未在 switch 中添加 case，编译报错
      const _exhaustive: never = v2Type
      void _exhaustive
      break
    }
  }

  return { refs, params: outputParams }
}

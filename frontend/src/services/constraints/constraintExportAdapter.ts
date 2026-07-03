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

import type { Node } from '@vue-flow/core'
import type { ConditionalConstraintNodeData, CustomNode, SchemaNodeData } from '@/types/graph'
import type { ConstraintTypeV2 } from '@/types/projectV2'
import type { AnyRecord } from '@/types/utility'
// resolveSchemaAndColumnIdByName 单一定义在 persistence/builders/constraint/helpers
import { resolveSchemaAndColumnIdByName } from '@/services/persistence/builders/constraint/helpers'

/** 通用节点引用结构 */
type RefLike = { nodeId?: string; columnId?: string }

export function buildConstraintExportPayload(params: {
  nodes: CustomNode[]
  constraintNodeId: string
  v2Type: ConstraintTypeV2
  data: AnyRecord
  schemaIdByNodeId: Record<string, string>
}): { refs: AnyRecord; params: AnyRecord } {
  const { nodes, constraintNodeId, v2Type, data, schemaIdByNodeId } = params
  const refs: AnyRecord = {}
  const outputParams: AnyRecord = {}
  const normalizeSchemaId = (value?: string) => (value ? schemaIdByNodeId[value] || value : value)

  switch (v2Type) {
    case 'AllowedValues': {
      const sourceRef = data.sourceRef as RefLike | undefined
      if (sourceRef?.nodeId && sourceRef?.columnId) {
        refs.table_id = normalizeSchemaId(sourceRef.nodeId)
        refs.column_id = sourceRef.columnId
      } else {
        const resolved = resolveSchemaAndColumnIdByName(
          nodes,
          String(data.table || ''),
          String(data.column || '')
        )
        if (resolved) {
          refs.table_id = resolved.tableId
          refs.column_id = resolved.columnId
        }
      }
      outputParams.allowed_values = Array.from((data.allowedValues as Iterable<unknown>) || []).map(
        (v) => String(v)
      )
      break
    }
    case 'ForeignKey': {
      const sRef = data.sourceRef as RefLike | undefined
      const tRef = data.targetRef as RefLike | undefined
      if (sRef?.nodeId && sRef?.columnId && tRef?.nodeId && tRef?.columnId) {
        refs.from_table_id = normalizeSchemaId(sRef.nodeId)
        refs.from_column_id = sRef.columnId
        refs.to_table_id = normalizeSchemaId(tRef.nodeId)
        refs.to_column_id = tRef.columnId
      }
      break
    }
    case 'Unique': {
      const sourceRef = data.sourceRef as RefLike | undefined
      if (sourceRef?.nodeId && sourceRef?.columnId) {
        refs.table_id = normalizeSchemaId(sourceRef.nodeId)
        refs.column_ids = [sourceRef.columnId]
      } else {
        const tableName = String(data.table || '')
        const tableResolved = nodes.find(
          (n) => n.type === 'schema' && (n.data as SchemaNodeData).tableName === tableName
        )
        if (tableResolved) {
          refs.table_id = schemaIdByNodeId[tableResolved.id] || tableResolved.id
          const schemaData = tableResolved.data as SchemaNodeData
          const columnName = String(data.column || '')
          const found = schemaData.columns.find((c) => c.columnName === columnName)
          if (found) refs.column_ids = [found.id]
        }
      }
      break
    }
    case 'NotNull':
    case 'Range':
    case 'Charset':
    case 'DateLogic': {
      const sourceRef = data.sourceRef as RefLike | undefined
      if (sourceRef?.nodeId && sourceRef?.columnId) {
        refs.table_id = normalizeSchemaId(sourceRef.nodeId)
        refs.column_id = sourceRef.columnId
      } else {
        const resolved = resolveSchemaAndColumnIdByName(
          nodes,
          String(data.table || ''),
          String(data.column || '')
        )
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
      const cd = data as Partial<ConditionalConstraintNodeData>
      const firstCondRef = cd.ifConditions?.find((c) => c.ref?.nodeId)?.ref
      const schemaId = String(cd.thenRef?.nodeId || cd.ifRef?.nodeId || firstCondRef?.nodeId || '')
      if (schemaId) {
        refs.table_id = normalizeSchemaId(schemaId)
        const schemaNode = nodes.find((n) => n.id === schemaId && n.type === 'schema')
        const schemaData = schemaNode?.data as SchemaNodeData | undefined
        const resolveColumnNameById = (colId?: string) =>
          schemaData ? schemaData.columns.find((c) => c.id === colId)?.columnName || '' : ''
        const resolveColumnIdByName = (colName?: string) =>
          schemaData ? schemaData.columns.find((c) => c.columnName === colName)?.id : undefined
        const thenColumnId = cd.thenRef?.columnId || resolveColumnIdByName(cd.thenColumn)
        if (thenColumnId) refs.then_column_id = thenColumnId
        refs.if_logic = cd.ifLogic || 'and'
        refs.if_conditions = (cd.ifConditions || [])
          .filter((cond) => cond.operator)
          .map((cond) => ({
            if_column_id: String(
              cond.ref?.columnId || cd.ifRef?.columnId || resolveColumnIdByName(cond.column) || ''
            ),
            operator: cond.operator,
            value: cond.value,
            values: cond.values,
          }))
          .filter((x) => !!x.if_column_id)
        if (!cd.thenColumn && thenColumnId) {
          const resolved = resolveColumnNameById(thenColumnId)
          if (resolved) cd.thenColumn = resolved
        }
      }
      outputParams.then_condition = cd.thenConditionConfig
      break
    }
    case 'Scripted': {
      const sourceRef = data.sourceRef as RefLike | undefined
      const schemaIdFromRef = sourceRef?.nodeId
      if (schemaIdFromRef) {
        refs.table_id = normalizeSchemaId(schemaIdFromRef)
        if (sourceRef?.columnId) refs.column_id = sourceRef.columnId
      } else {
        const tableName = String(data.table || '')
        const schemaNode = nodes.find(
          (n) => n.type === 'schema' && (n.data as SchemaNodeData).tableName === tableName
        )
        if (schemaNode) refs.table_id = schemaIdByNodeId[schemaNode.id] || schemaNode.id
      }
      outputParams.name =
        (data.constraintName as string | undefined) ||
        (data.configName as string | undefined) ||
        constraintNodeId
      outputParams.expression = (data.script as string | undefined) || ''
      break
    }
    case 'Composite': {
      const sourceRef = data.sourceRef as RefLike | undefined
      if (sourceRef?.nodeId && sourceRef?.columnId) {
        refs.table_id = normalizeSchemaId(sourceRef.nodeId)
        refs.column_id = sourceRef.columnId
      }
      outputParams.logic = (data.logic as string | undefined) || 'all'

      // 优先使用 includedNodeIds（引用主画布上的独立约束节点）
      const includedNodeIds: string[] = (data.includedNodeIds as string[] | undefined) || []
      if (includedNodeIds.length > 0) {
        outputParams.sub_constraints = includedNodeIds
          .map((nodeId) => {
            const subNode = nodes.find((n) => n.id === nodeId)
            if (!subNode || !subNode.type?.endsWith('Constraint')) return null
            const subData = (subNode.data || {}) as Record<string, unknown>
            const subV2Type = subNode.type.replace('Constraint', '')
            const subRefs: Record<string, unknown> = {}
            if (typeof subData.table === 'string') {
              const resolved = resolveSchemaAndColumnIdByName(
                nodes,
                String(subData.table),
                String(subData.column || '')
              )
              if (resolved) {
                subRefs.table_id = resolved.tableId
                subRefs.column_id = resolved.columnId
              }
            }
            const subSourceRef = subData.sourceRef as RefLike | undefined
            if (subSourceRef?.nodeId && subSourceRef?.columnId) {
              subRefs.table_id = normalizeSchemaId(subSourceRef.nodeId)
              subRefs.column_id = subSourceRef.columnId
            }
            return {
              id: subNode.id,
              type: subV2Type.charAt(0).toUpperCase() + subV2Type.slice(1),
              enabled: (subData.enabled as boolean | undefined) !== false,
              description:
                (subData.configName as string | undefined) ||
                (subData.description as string | undefined) ||
                undefined,
              refs: subRefs,
              params: {},
            }
          })
          .filter(Boolean)
      } else {
        // 向后兼容：从 subGraph.nodes 导出
        const subGraph = data.subGraph as { nodes?: Node[] } | undefined
        const subNodes = subGraph?.nodes || []
        outputParams.sub_constraints = subNodes
          .filter((subNode) => subNode.type && subNode.type.endsWith('Constraint'))
          .map((subNode) => {
            const subData = (subNode.data || {}) as Record<string, unknown>
            const subV2Type = String(subNode.type).replace('Constraint', '')
            const subRefs: Record<string, unknown> = {}
            if (typeof subData.table === 'string') {
              const resolved = resolveSchemaAndColumnIdByName(
                nodes,
                String(subData.table),
                String(subData.column || '')
              )
              if (resolved) {
                subRefs.table_id = resolved.tableId
                subRefs.column_id = resolved.columnId
              }
            }
            const subSourceRef = subData.sourceRef as RefLike | undefined
            if (subSourceRef?.nodeId && subSourceRef?.columnId) {
              subRefs.table_id = normalizeSchemaId(subSourceRef.nodeId)
              subRefs.column_id = subSourceRef.columnId
            }
            return {
              id: subNode.id,
              type: subV2Type.charAt(0).toUpperCase() + subV2Type.slice(1),
              enabled: (subData.enabled as boolean | undefined) !== false,
              description:
                (subData.configName as string | undefined) ||
                (subData.description as string | undefined) ||
                undefined,
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

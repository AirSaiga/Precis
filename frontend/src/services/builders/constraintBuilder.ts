/**
 * @file constraintBuilder.ts
 * @description Constraint 节点文件构建器
 *
 * 该模块负责将 Constraint 节点数据构建为 .constraint.yaml 文件格式，
 * 支持所有约束类型（ForeignKey, Unique, NotNull, AllowedValues, Conditional, Scripted）。
 *
 * 功能：
 * 1. 根据约束类型选择正确的构建逻辑
 * 2. 解析节点引用（table_id, column_id 等）
 * 3. 构建约束参数配置
 */

import type { CustomNode, SchemaNodeData } from '@/types/graph'
import type { ConstraintFileV2, ConstraintTypeV2 } from '@/types/projectV2'
import { buildConstraintExportPayload } from '@/services/constraints/constraintExportAdapter'
import {
  getV2ConstraintTypeByNodeType,
  isConstraintNodeType,
} from '@/services/constraints/validationRegistry'
import { buildSchemaIdByNodeId } from '@/services/builders/v2/manifestBuilder'

/**
 * 根据表名和列名查找对应的节点和列 ID
 */
export function resolveSchemaAndColumnIdByName(
  nodes: CustomNode[],
  tableName: string,
  columnName: string
): { tableId: string; columnId: string } | null {
  const schemaIdByNodeId = buildSchemaIdByNodeId(nodes)
  const schemaNode = nodes.find(
    (n) => n.type === 'schema' && (n.data as SchemaNodeData).tableName === tableName
  )
  if (!schemaNode) return null
  const schemaData = schemaNode.data as SchemaNodeData
  const col = schemaData.columns.find((c) => c.columnName === columnName)
  if (!col) return null
  const tableId = schemaIdByNodeId[schemaNode.id] || schemaNode.id
  return { tableId, columnId: col.id }
}

/**
 * 构建 V2 Constraint 文件
 *
 * 将 Constraint 节点转换为后端可解析的 YAML 格式
 *
 * @param constraintNodeId - Constraint 节点 ID
 * @param nodes - 图中所有节点
 * @returns Constraint 文件对象
 *
 * @example
 * ```typescript
 * const constraintFile = buildV2ConstraintFile('constraint-1', nodes);
 * ```
 * @deprecated 请使用 constraint builders (src/services/persistence/builders/constraint/)
 */
export function buildV2ConstraintFile(
  constraintNodeId: string,
  nodes: CustomNode[]
): ConstraintFileV2 {
  const node = nodes.find((n) => n.id === constraintNodeId && isConstraintNodeType(n.type))
  if (!node) throw new Error('未找到约束节点')

  const schemaIdByNodeId = buildSchemaIdByNodeId(nodes)
  const v2Type = getV2ConstraintTypeByNodeType(node.type)
  if (!v2Type) throw new Error('不支持的约束类型')
  const data: any = node.data || {}
  const { refs, params } = buildConstraintExportPayload({
    nodes,
    constraintNodeId,
    v2Type: v2Type as ConstraintTypeV2,
    data,
    schemaIdByNodeId,
  })

  return {
    version: 2,
    id: constraintNodeId,
    type: v2Type,
    enabled: data.enabled !== false,
    description: data.configName || data.description || undefined,
    refs,
    params,
  }
}

/**
 * @fileoverview Constraint Builder 共享工具
 *
 * 提供约束 builder 通用的辅助函数：
 * - 解析 sourceRef 构建 refs
 * - 根据表名/列名查找 schema 和列
 *
 * 语义化 ID 方案：节点 ID 直接作为 schema ID
 */

import type { CustomNode, SchemaNodeData } from '@/types/graph'

/**
 * 根据表名和列名查找 schema 节点和列 ID
 */
export function resolveSchemaAndColumnIdByName(
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

  // 语义化 ID：节点 ID 即 schema ID
  return { tableId: schemaNode.id, columnId: col.id }
}

/**
 * 规范化 schema ID
 */
export function normalizeSchemaId(
  value: string | undefined,
  schemaIdByNodeId: Record<string, string>
): string | undefined {
  return value ? schemaIdByNodeId[value] || value : value
}

/**
 * 安全获取 sourceRef
 */
export function getSourceRef(
  data: Record<string, unknown>
): { nodeId: string; columnId: string } | undefined {
  const ref = data.sourceRef as { nodeId?: string; columnId?: string } | undefined
  if (ref?.nodeId && ref?.columnId) {
    return { nodeId: ref.nodeId, columnId: ref.columnId }
  }
  return undefined
}

/**
 * 通用 table_id/column_id 解析
 */
export function buildSingleColumnRefs(
  data: Record<string, unknown>,
  nodes: CustomNode[],
  schemaIdByNodeId: Record<string, string>
): { table_id?: string; column_id?: string } {
  const sourceRef = getSourceRef(data)
  if (sourceRef) {
    return {
      table_id: normalizeSchemaId(sourceRef.nodeId, schemaIdByNodeId) || sourceRef.nodeId,
      column_id: sourceRef.columnId,
    }
  }

  const tableName = data.table as string
  const columnName = data.column as string
  if (tableName && columnName) {
    const resolved = resolveSchemaAndColumnIdByName(nodes, tableName, columnName)
    if (resolved) {
      return { table_id: resolved.tableId, column_id: resolved.columnId }
    }
  }

  return {}
}

/**
 * @file regexEdgeResolver.ts
 * @description Regex 节点 Edge-Driven 源解析器
 *
 * 从 Vue Flow 边（edges）中推导正则节点的上游 Schema/列绑定，
 * 不依赖 node data 中的 sourceNodeId / sourceColumnName 字段。
 *
 * 策略：
 * - 查找 incoming edge：target === regexNodeId && targetHandle === 'regex-input'
 * - 解析 sourceHandle（source-right-{columnId}）获取列 ID
 * - 两类上游：Schema（含 jsonSchema）和 TransformOutput / ManualData
 */

import type { CustomNode } from '@/types/graph'

export interface RegexSourceInfo {
  /** 上游 Schema 节点 ID（或 TransformOutput/ManualData 节点 ID） */
  sourceNodeId: string
  /** 上游节点对象 */
  sourceNode: CustomNode
  /** 列 ID（从 sourceHandle 解析） */
  columnId: string
  /** 列名（从 Schema.columns 查找或 TransformOutput.columnName） */
  columnName: string
  /** 上游类型：'schema' | 'jsonSchema' | 'transformOutput' | 'manualData' */
  sourceType: string
  /** 边 ID */
  edgeId: string
}

/**
 * 解析正则节点的上游绑定，返回完整的源信息。
 * 如果找不到对应的边或无法解析列，返回 null。
 */
export function resolveRegexSource(
  regexNodeId: string,
  nodes: CustomNode[],
  edges: {
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
    [key: string]: unknown
  }[]
): RegexSourceInfo | null {
  const incomingEdge = edges.find(
    (e) =>
      e.target === regexNodeId &&
      (e.targetHandle === 'regex-input' ||
        e.targetHandle === 'regexExtract-input' ||
        !e.targetHandle)
  )
  if (!incomingEdge) return null

  const sourceNode = nodes.find((n) => n.id === incomingEdge.source)
  if (!sourceNode) return null

  const sourceType = sourceNode.type as string

  if (sourceType === 'schema' || sourceType === 'jsonSchema') {
    const sourceHandle = (incomingEdge.sourceHandle as string) || ''
    if (!sourceHandle.startsWith('source-right-')) return null
    const columnId = sourceHandle.replace('source-right-', '')
    const schemaData = sourceNode.data as unknown as Record<string, unknown>
    const columns = (schemaData.columns as unknown[] | undefined) || []
    const column = columns.find((c) => (c as Record<string, unknown>).id === columnId) as
      | Record<string, unknown>
      | undefined
    if (!column) return null
    return {
      sourceNodeId: sourceNode.id,
      sourceNode,
      columnId,
      columnName: (column.columnName as string) || '',
      sourceType,
      edgeId: incomingEdge.id as string,
    }
  }

  if (sourceType === 'transformOutput' || sourceType === 'manualData') {
    const sourceData = sourceNode.data as unknown as Record<string, unknown>
    const sourceHandle = (incomingEdge.sourceHandle as string) || ''
    const columnId = sourceHandle.startsWith('source-right-')
      ? sourceHandle.replace('source-right-', '')
      : '0'
    const columnName = (sourceData.columnName as string) || 'Column1'
    return {
      sourceNodeId: sourceNode.id,
      sourceNode,
      columnId,
      columnName,
      sourceType,
      edgeId: incomingEdge.id as string,
    }
  }

  return null
}

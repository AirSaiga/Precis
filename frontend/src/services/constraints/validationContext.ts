/**
 * @file validationContext.ts
 * @description 约束验证上下文构建（纯函数）
 *
 * 从 validationRegistryCore 拆出，避免 regex 校验模块与注册表核心之间的循环依赖。
 */

import type { Edge, Node } from '@vue-flow/core'
import type { ConstraintValidationContext } from './types'
import { findJsonSchemaColumnById } from '@/utils/nodes/json/columnFinder'

export function buildValidationContext(params: {
  schemaNode: Node
  constraintNode: Node
  edge: Edge
  nodes: Node[]
}): ConstraintValidationContext | null {
  const { schemaNode, constraintNode, edge } = params
  const sourceHandle = edge.sourceHandle || ''
  if (!sourceHandle.startsWith('source-right-')) return null
  const columnId = sourceHandle.replace('source-right-', '')
  const schemaData = (schemaNode.data || {}) as Record<string, unknown>

  // 根据节点类型查找列：jsonSchema 支持嵌套 children，schema 保持平面查找
  let column: Record<string, unknown> | undefined
  if (schemaNode.type === 'jsonSchema') {
    const found = findJsonSchemaColumnById(
      schemaData.columns as import('@/types/graph').JsonSchemaColumn[],
      columnId
    )
    column = found ? (found.column as unknown as Record<string, unknown>) : undefined
  } else {
    column = ((schemaData.columns || []) as unknown[]).find(
      (c) => (c as Record<string, unknown>).id === columnId
    ) as Record<string, unknown> | undefined
  }
  if (!column) return null

  return {
    nodes: params.nodes,
    schemaNode,
    constraintNode,
    edge,
    columnId,
    columnName: column.columnName as string,
    columnDataType: (column.dataType as string) || undefined,
    sourceFilePath: (schemaData.localPath || schemaData.sourceFilePath) as string,
    sourceFile: schemaData.sourceFile as string,
    sheetName: schemaData.sheetName as string,
    headerRow: typeof schemaData.headerRow === 'number' ? schemaData.headerRow : 0,
    // 优先使用列级 jsonPath(精确到嵌套叶子字段,如 $.user.address.city),
    // 回退到节点级 jsonPath(用于整体 JSON 路径)
    jsonPath: (column.jsonPath as string) || (schemaData.jsonPath as string) || undefined,
    recordPath: (schemaData.recordPath as string) || undefined,
    jsonFormat: (schemaData.format as string) || undefined,
  }
}

/**
 * @fileoverview Schema Builder
 *
 * 将 schema/jsonSchema 节点转换为 TableSchemaFileV2。
 */

import type { CustomNode, SchemaNodeData, JsonSchemaNodeData, JsonSchemaColumn, SchemaColumn } from '@/types/graph'
import type { ColumnSpecV2, ConstraintItemV2, TableSchemaFileV2 } from '@/types/projectV2'
import { generateSchemaId } from '@/utils/typeHelpers'
import {
  toBackendType,
  toJsonBackendType,
  flattenJsonColumns,
  buildJSONOptions,
} from '@/services/builders/schemaBuilder'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
import { toPosixPath } from '@/core/utils/pathNormalization'
import { buildEmbeddedConstraintItem } from '../embedders/embeddedConstraintBuilder'
import type { BuilderContext, NodeBuilder } from '../types'

/**
 * 构建 Schema 列定义
 */
function buildColumnSpec(column: SchemaColumn): ColumnSpecV2 {
  const base: ColumnSpecV2 = {
    id: column.id,
    name: column.columnName,
    type: toBackendType(column.dataType, column),
    primary_key: (column as any).primaryKey || false,
    nullable: (column as any).nullable,
    expand: (column as any).expand || false,
  }

  if (column.extractedConfig) {
    base.type = {
      name: 'Extracted',
      source_column: column.extractedConfig.sourceColumn,
      extract_key: column.extractedConfig.extractKey,
      result_type: column.extractedConfig.resultType || 'String',
    }
  }

  return base
}

/**
 * 构建 JSON Schema 列定义（递归）
 */
function buildJsonColumnSpec(column: JsonSchemaColumn): ColumnSpecV2 {
  const base: ColumnSpecV2 = {
    id: column.id,
    name: column.columnName,
    type: toJsonBackendType(column.dataType),
    primary_key: column.primaryKey || false,
    nullable: column.nullable,
    expand: column.isExpanded || false,
    json_path: column.jsonPath,
  }

  if (column.children && column.children.length > 0) {
    base.children = column.children.map(buildJsonColumnSpec)
  }

  return base
}

/**
 * 构建 SourceSpec
 *
 * 处理 sourcePathMode / localPath / sourceFilePath 的优先级：
 * - absolute_file 模式优先使用 localPath
 * - relative_file 模式使用 sourceFilePath
 * - 兼容旧版 sourceMode='localfile' 的回退逻辑
 */
function buildSourceSpec(node: CustomNode): TableSchemaFileV2['source'] {
  const data = node.data as SchemaNodeData | JsonSchemaNodeData
  if (!data.sourceFilePath && !data.sourceFile && !(data as SchemaNodeData).localPath) return undefined

  const isJsonSchema = node.type === 'jsonSchema'
  const schemaData = data as SchemaNodeData

  const resolvedRelative = data.sourceFilePath
  const resolvedAbsolute = schemaData.localPath
  const mode = data.sourcePathMode

  let source: TableSchemaFileV2['source']

  if (mode === 'absolute_file') {
    if (resolvedAbsolute) {
      source = {
        mode: 'absolute_file',
        path: toPosixPath(resolvedAbsolute),
        header_row: typeof data.headerRow === 'number' ? data.headerRow : 0,
      }
    }
  } else if (mode === 'relative_file') {
    if (resolvedRelative) {
      source = {
        mode: 'relative_file',
        path: toPosixPath(resolvedRelative),
        header_row: typeof data.headerRow === 'number' ? data.headerRow : 0,
      }
    }
  } else if (resolvedAbsolute && schemaData.sourceMode === 'localfile') {
    // 兼容旧版 localfile 模式
    source = {
      mode: 'absolute_file',
      path: resolvedAbsolute.replace(/\\/g, '/'),
      header_row: typeof data.headerRow === 'number' ? data.headerRow : 0,
    }
  } else if (resolvedRelative) {
    source = {
      mode: 'relative_file',
      path: resolvedRelative.replace(/\\/g, '/'),
      header_row: typeof data.headerRow === 'number' ? data.headerRow : 0,
    }
  } else if (resolvedAbsolute) {
    source = {
      mode: 'absolute_file',
      path: resolvedAbsolute.replace(/\\/g, '/'),
      header_row: typeof data.headerRow === 'number' ? data.headerRow : 0,
    }
  }

  if (!source) return undefined

  if (isJsonSchema) {
    const jsonData = data as JsonSchemaNodeData
    return {
      ...source,
      options: buildJSONOptions(jsonData as any),
    }
  }

  if (schemaData.sheetName) {
    return {
      ...source,
      sheet: schemaData.sheetName,
    }
  }

  return source
}

/**
 * Schema Builder 实现
 */
/**
 * 从列定义的 constraints 标志构建内嵌约束项
 */
function buildColumnConstraints(columns: SchemaColumn[]): ConstraintItemV2[] {
  const result: ConstraintItemV2[] = []
  for (const col of columns) {
    if (!col.constraints) continue

    if (col.constraints.notNull) {
      result.push({
        id: `${col.id || col.columnName}_notNull`,
        type: 'NotNull',
        enabled: true,
        description: `NotNull constraint for ${col.columnName}`,
        column: col.columnName,
        params: {},
      })
    }

    if (col.constraints.unique) {
      result.push({
        id: `${col.id || col.columnName}_unique`,
        type: 'Unique',
        enabled: true,
        description: `Unique constraint for ${col.columnName}`,
        column: col.columnName,
        params: {},
      })
    }

    if (
      col.constraints.allowedValues &&
      Array.isArray(col.constraints.allowedValues) &&
      col.constraints.allowedValues.length > 0
    ) {
      result.push({
        id: `${col.id || col.columnName}_allowedValues`,
        type: 'AllowedValues',
        enabled: true,
        description: `AllowedValues constraint for ${col.columnName}`,
        column: col.columnName,
        params: { allowed_values: col.constraints.allowedValues.map(String) },
      })
    }
  }
  return result
}

/**
 * 收集与指定 schema 关联的内嵌约束节点
 */
function collectEmbeddedConstraints(
  schemaNode: CustomNode,
  allNodes: CustomNode[]
): ConstraintItemV2[] {
  const schemaData = schemaNode.data as SchemaNodeData
  const childrenIds = schemaData.children || []

  // 1. 从 children 收集
  const fromChildren = childrenIds
    .map((id) => allNodes.find((n) => n.id === id))
    .filter((n): n is CustomNode =>
      !!n && typeof n.type === 'string' && isConstraintNodeType(n.type)
    )
    .map((n) => {
      try {
        return buildEmbeddedConstraintItem(n)
      } catch {
        return null
      }
    })
    .filter((item): item is ConstraintItemV2 => item !== null)

  // 2. 从 legacy embedded 标记 + sourceRef/thenRef/ifRef 收集
  const fromLegacy = allNodes
    .filter((n) => {
      if (!n.type || !isConstraintNodeType(n.type)) return false
      const d = (n.data || {}) as Record<string, unknown>
      const embedded = (d as any).embedded === true
      if (!embedded) return false
      const sourceRef = d.sourceRef as { nodeId?: string } | undefined
      const thenRef = d.thenRef as { nodeId?: string } | undefined
      const ifRef = d.ifRef as { nodeId?: string } | undefined
      return (
        sourceRef?.nodeId === schemaNode.id ||
        thenRef?.nodeId === schemaNode.id ||
        ifRef?.nodeId === schemaNode.id
      )
    })
    .map((n) => {
      try {
        return buildEmbeddedConstraintItem(n)
      } catch {
        return null
      }
    })
    .filter((item): item is ConstraintItemV2 => item !== null)

  const seen = new Set(fromChildren.map((c) => c.id))
  return [
    ...fromChildren,
    ...fromLegacy.filter((c) => !seen.has(c.id)),
  ]
}

export const schemaBuilder: NodeBuilder<TableSchemaFileV2> = {
  kind: 'schema',
  matches: (node) => node.type === 'schema' || node.type === 'jsonSchema',
  build({ node, nodes }: BuilderContext): { consumed: boolean; file: TableSchemaFileV2 } {
    const data = node.data as SchemaNodeData | JsonSchemaNodeData
    const isJsonSchema = node.type === 'jsonSchema'
    const sheetName = isJsonSchema ? undefined : (data as SchemaNodeData).sheetName
    const schemaId = generateSchemaId(
      data.sourceFilePath || data.sourceFile || (data as SchemaNodeData).localPath || '',
      sheetName
    )

    const columns = isJsonSchema
      ? (data as JsonSchemaNodeData).columns.map(buildJsonColumnSpec)
      : (data as SchemaNodeData).columns.map(buildColumnSpec)

    // 扁平化 JSON 列以兼容某些旧逻辑
    const flatColumns = isJsonSchema
      ? flattenJsonColumns((data as JsonSchemaNodeData).columns)
      : columns

    // 收集内嵌约束
    const embeddedConstraints = isJsonSchema
      ? []
      : collectEmbeddedConstraints(node, nodes)
    const columnConstraints = isJsonSchema
      ? []
      : buildColumnConstraints((data as SchemaNodeData).columns)

    return {
      consumed: true,
      file: {
        version: 2,
        id: schemaId,
        name: data.tableName,
        source: buildSourceSpec(node),
        columns: flatColumns,
        constraints: [...embeddedConstraints, ...columnConstraints],
        script_checks: [],
      },
    }
  },
}

/**
 * @file v2/schemaBuilder.ts
 * @description V2 Schema 构建器（独立子模块）
 *
 * 从 v2ProjectBuilder.ts 提取的 Schema 构建逻辑，
 * 包含 buildV2SchemaFile 和 buildV2JsonSchemaFile 两个入口函数。
 *
 * 功能：
 * 1. buildV2SchemaFile: 构建普通 Schema 文件（Excel/CSV）
 * 2. buildV2JsonSchemaFile: 构建 JSON Schema 文件
 */

import type {
  CustomNode,
  SchemaNodeData,
  RegexNodeData,
  JsonSchemaNodeData,
  JsonSchemaColumn,
} from '@/types/graph'
import type {
  TableSchemaFileV2,
  ColumnSpecV2,
  ConstraintItemV2,
  ConstraintTypeV2,
} from '@/types/projectV2'
import {
  toBackendType,
  buildJSONOptions,
  toJsonBackendType,
  flattenJsonColumns,
} from '../schemaBuilder'
import { i18n } from '@/i18n'
import {
  getV2ConstraintTypeByNodeType,
  isConstraintNodeType,
} from '@/services/constraints/validationRegistry'

function buildConstraintItemFromNode(node: CustomNode): ConstraintItemV2 | null {
  const d = (node.data || {}) as Record<string, unknown>
  const v2Type = getV2ConstraintTypeByNodeType(node.type)
  if (!v2Type) return null

  if (v2Type === 'AllowedValues') {
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: d.column as string,
      params: {
        allowed_values: Array.from((d.allowedValues || []) as unknown[]).map((x: unknown) =>
          String(x)
        ),
      },
    }
  }

  if (v2Type === 'NotNull') {
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: d.column as string,
      params: {},
    }
  }

  if (v2Type === 'Unique') {
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: (d.column as string) || '',
      params: {},
    }
  }

  if (v2Type === 'ForeignKey') {
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      from_table: d.sourceTable as string,
      from_column: d.sourceColumn as string,
      to_table: d.targetTable as string,
      to_column: d.targetColumn as string,
      params: {},
    }
  }

  if (v2Type === 'Scripted') {
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: d.column as string,
      params: {
        name: d.constraintName || d.configName || node.id,
        expression: d.script || '',
      },
    }
  }

  if (v2Type === 'Conditional') {
    // ⚠️ 后端兼容性说明：
    // 后端 factory.py 从 refs 读取 if_logic/if_conditions，但 ConstraintItem 无 refs 字段。
    // embedded_constraints.py 在转换时需将这些字段从 params 提取到 refs。
    // standalone 场景（constraintExportAdapter.ts）已正确写入 refs。
    const params: Record<string, unknown> = {
      then_condition: d.thenConditionConfig,
    }

    // THEN 列
    const thenRef = d.thenRef as { columnId?: string; nodeId?: string } | undefined
    const thenColId = thenRef?.columnId || (d.thenColumn as string)
    if (thenColId) params.then_column_id = thenColId

    // 表引用
    const ifRef = d.ifRef as { nodeId?: string } | undefined
    const sourceRef = d.sourceRef as { nodeId?: string } | undefined
    const tableId = thenRef?.nodeId || ifRef?.nodeId || sourceRef?.nodeId
    if (tableId) params.table_id = tableId

    // IF 条件
    if (d.ifLogic) params.if_logic = d.ifLogic
    interface ConditionalConditionInput {
      operator?: string
      ref?: { columnId?: string }
      column?: string
      value?: unknown
      values?: unknown
    }
    interface ConditionalConditionOutput {
      if_column_id: string
      operator: string
      value?: unknown
      values?: unknown
    }
    const ifConditions = d.ifConditions as unknown as ConditionalConditionInput[] | undefined
    if (Array.isArray(ifConditions)) {
      const validConditions = ifConditions
        .filter((c): c is ConditionalConditionInput & { operator: string } => {
          if (!c?.operator) {
            console.warn(`[schemaBuilder] Conditional ${node.id}: 跳过缺少 operator 的条件`)
            return false
          }
          return true
        })
        .map((c): ConditionalConditionOutput => {
          const result: ConditionalConditionOutput = {
            if_column_id: c.ref?.columnId || c.column || '',
            operator: c.operator,
          }
          if (c.value !== undefined) result.value = c.value
          if (c.values) result.values = c.values
          return result
        })
        .filter((c) => {
          if (!c.if_column_id) {
            console.warn(
              `[schemaBuilder] Conditional ${node.id}: 跳过缺少 if_column_id 的条件 (operator=${c.operator})`
            )
            return false
          }
          return true
        })

      if (validConditions.length < ifConditions.length) {
        console.warn(
          `[schemaBuilder] Conditional ${node.id}: ${ifConditions.length - validConditions.length} 个条件被丢弃，仅保留 ${validConditions.length} 个有效条件`
        )
      }

      params.if_conditions = validConditions
    }

    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: thenColId,
      params,
    }
  }

  if (v2Type === 'Range') {
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: d.column as string,
      params: {
        min: d.minValue,
        max: d.maxValue,
        boundary_mode: d.boundaryMode || 'inclusive',
      },
    }
  }

  if (v2Type === 'Charset') {
    const params: Record<string, unknown> = {
      charset_mode: d.charsetMode || 'ascii',
    }
    if (d.allowedChars) params.allowed_chars = d.allowedChars
    if (d.disallowedChars) params.disallowed_chars = d.disallowedChars
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: d.column as string,
      params,
    }
  }

  if (v2Type === 'DateLogic') {
    const params: Record<string, unknown> = {
      logic_mode: (d.logicMode as string) || 'compare',
    }
    if (d.logicMode === 'compare') {
      params.compare_op = (d.compareOp as string) || 'gt'
      if (d.referenceDate) params.reference_date = d.referenceDate as string
      if (d.referenceColumn) params.reference_column = d.referenceColumn as string
    } else {
      params.calculation_type = (d.calculationType as string) || 'age'
      if (d.targetValue) params.target_value = d.targetValue as string
      if (d.targetColumn) params.target_column = d.targetColumn as string
    }
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: d.column as string,
      params,
    }
  }

  if (v2Type === 'Composite') {
    // Composite 约束强制独立保存，内嵌时仅保留基本信息作为降级
    console.warn(
      `[schemaBuilder] Composite 约束 ${node.id} 尝试内嵌保存，已降级。建议改为独立保存。`
    )
    return {
      id: node.id,
      type: v2Type,
      enabled: d.enabled !== false,
      description: (d.configName as string) || undefined,
      params: {
        logic: d.logic || 'all',
      },
    }
  }

  return {
    id: node.id,
    type: v2Type,
    enabled: true,
    description: (d.configName as string) || undefined,
    params: {},
  }
}

/**
 * 构建 V2 Schema 文件
 *
 * 支持普通 Schema 节点和 JSON Schema 节点
 *
 * @param nodes - 图中所有节点
 * @param schemaNodeId - Schema 节点 ID
 * @returns Schema 文件对象
 * @deprecated 请使用 schemaBuilder (src/services/persistence/builders/schemaBuilder.ts)
 */
export function buildV2SchemaFile(nodes: CustomNode[], schemaNodeId: string): TableSchemaFileV2 {
  const node = nodes.find(
    (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
  )
  if (!node) throw new Error(i18n.global.t('messages.builder.schemaNodeNotFound'))

  const isJsonSchema = node.type === 'jsonSchema'

  if (isJsonSchema) {
    return buildV2JsonSchemaFile(node, nodes)
  }

  const data = node.data as SchemaNodeData

  const resolvedRelative = data.sourceFilePath
  const resolvedAbsolute = data.localPath

  const source =
    data.sourcePathMode === 'absolute_file'
      ? resolvedAbsolute
        ? {
            mode: 'absolute_file' as const,
            path: resolvedAbsolute,
            sheet: data.sheetName,
            header_row: data.headerRow || 0,
          }
        : undefined
      : data.sourcePathMode === 'relative_file'
        ? resolvedRelative
          ? {
              mode: 'relative_file' as const,
              path: resolvedRelative,
              sheet: data.sheetName,
              header_row: data.headerRow || 0,
            }
          : undefined
        : resolvedAbsolute && data.sourceMode === 'localfile'
          ? {
              mode: 'absolute_file' as const,
              path: resolvedAbsolute,
              sheet: data.sheetName,
              header_row: data.headerRow || 0,
            }
          : resolvedRelative
            ? {
                mode: 'relative_file' as const,
                path: resolvedRelative,
                sheet: data.sheetName,
                header_row: data.headerRow || 0,
              }
            : undefined

  const childrenIds = (data as unknown as Record<string, unknown>).children as string[] | undefined

  const embeddedConstraintsFromChildren =
    childrenIds && childrenIds.length > 0
      ? (childrenIds
          .map((id) => nodes.find((n) => n.id === id))
          .filter((n): n is CustomNode => !!n && isConstraintNodeType(n.type))
          .map(buildConstraintItemFromNode)
          .filter(Boolean) as ConstraintItemV2[])
      : []

  const embeddedConstraintsLegacy = nodes
    .filter(
      (n) => isConstraintNodeType(n.type) && (n.data as { embedded?: boolean })?.embedded === true
    )
    .filter((n) => {
      const d = (n.data || {}) as Record<string, unknown>
      if ((d.sourceRef as Record<string, unknown>)?.nodeId)
        return (d.sourceRef as Record<string, unknown>).nodeId === schemaNodeId
      if ((d.thenRef as Record<string, unknown>)?.nodeId)
        return (d.thenRef as Record<string, unknown>).nodeId === schemaNodeId
      if ((d.ifRef as Record<string, unknown>)?.nodeId)
        return (d.ifRef as Record<string, unknown>).nodeId === schemaNodeId
      return false
    })
    .map(buildConstraintItemFromNode)
    .filter(Boolean) as ConstraintItemV2[]

  const embeddedConstraintIds = new Set(embeddedConstraintsFromChildren.map((c) => c.id))
  const embeddedConstraints = [
    ...embeddedConstraintsFromChildren,
    ...embeddedConstraintsLegacy.filter((c) => !embeddedConstraintIds.has(c.id)),
  ]

  const columnConstraints: Array<{
    id: string
    type: ConstraintTypeV2
    enabled: boolean
    description?: string
    column?: string
    params?: Record<string, unknown>
  }> = []
  for (const col of data.columns || []) {
    const colConstraints = col.constraints
    if (!colConstraints) continue
    const colId = col.id || col.columnName

    if (colConstraints.notNull) {
      columnConstraints.push({
        id: `${colId}_notNull`,
        type: 'NotNull' as const,
        enabled: true,
        description: `NotNull constraint for ${col.columnName}`,
        column: col.columnName,
        params: {},
      })
    }

    if (colConstraints.unique) {
      columnConstraints.push({
        id: `${colId}_unique`,
        type: 'Unique' as const,
        enabled: true,
        description: `Unique constraint for ${col.columnName}`,
        column: col.columnName,
        params: {},
      })
    }

    if (
      colConstraints.allowedValues &&
      Array.isArray(colConstraints.allowedValues) &&
      colConstraints.allowedValues.length > 0
    ) {
      columnConstraints.push({
        id: `${colId}_allowedValues`,
        type: 'AllowedValues' as const,
        enabled: true,
        description: `AllowedValues constraint for ${col.columnName}`,
        column: col.columnName,
        params: { allowed_values: colConstraints.allowedValues.map(String) },
      })
    }
  }

  const allConstraints = [...embeddedConstraints, ...columnConstraints]

  return {
    version: 2,
    id: schemaNodeId,
    name: data.tableName,
    source,
    columns: (data.columns || []).map((col): Record<string, unknown> => {
      const columnDef: Record<string, unknown> = {
        id: col.id,
        name: col.columnName,
        type: toBackendType(col.dataType, col),
        primary_key: false,
        expand: false,
      }
      if (col.extractedConfig) {
        columnDef.type = {
          name: 'Extracted',
          source_column: col.extractedConfig.sourceColumn,
          extract_key: col.extractedConfig.extractKey,
          result_type: col.extractedConfig.resultType || 'String',
        }
      }
      return columnDef
    }) as unknown as ColumnSpecV2[],
    constraints: allConstraints as ConstraintItemV2[],
    script_checks: [],
  }
}

/**
 * 构建 JSON Schema 文件
 *
 * 将 JsonSchema 节点转换为后端可解析的 YAML 格式，包含 JSON 特有的 source options
 *
 * @param node - JsonSchema 节点
 * @param nodes - 图中所有节点
 * @returns Schema 文件对象
 */
export function buildV2JsonSchemaFile(node: CustomNode, nodes: CustomNode[]): TableSchemaFileV2 {
  const data = node.data as JsonSchemaNodeData

  const resolvedRelative = data.sourceFilePath
  const resolvedAbsolute = data.localPath

  const jsonOptions = buildJSONOptions(data)

  const source =
    data.sourcePathMode === 'absolute_file'
      ? resolvedAbsolute
        ? {
            mode: 'absolute_file' as const,
            path: resolvedAbsolute,
            sheet: undefined,
            header_row: data.headerRow || 0,
            options: jsonOptions,
          }
        : undefined
      : data.sourcePathMode === 'relative_file'
        ? resolvedRelative
          ? {
              mode: 'relative_file' as const,
              path: resolvedRelative,
              sheet: undefined,
              header_row: data.headerRow || 0,
              options: jsonOptions,
            }
          : undefined
        : resolvedAbsolute && data.sourceMode === 'localfile'
          ? {
              mode: 'absolute_file' as const,
              path: resolvedAbsolute,
              sheet: undefined,
              header_row: data.headerRow || 0,
              options: jsonOptions,
            }
          : resolvedRelative
            ? {
                mode: 'relative_file' as const,
                path: resolvedRelative,
                sheet: undefined,
                header_row: data.headerRow || 0,
                options: jsonOptions,
              }
            : undefined

  const childrenIds = (node.data as unknown as Record<string, unknown>).children as
    | string[]
    | undefined

  const embeddedConstraintsFromChildren =
    childrenIds && childrenIds.length > 0
      ? (childrenIds
          .map((id) => nodes.find((n) => n.id === id))
          .filter((n): n is CustomNode => !!n && isConstraintNodeType(n.type))
          .map(buildConstraintItemFromNode)
          .filter(Boolean) as ConstraintItemV2[])
      : []

  const embeddedConstraintsLegacy = nodes
    .filter(
      (n) =>
        isConstraintNodeType(n.type) &&
        (n.data as unknown as Record<string, unknown>)?.embedded === true
    )
    .filter((n) => {
      const d = (n.data || {}) as Record<string, unknown>
      if ((d.sourceRef as Record<string, unknown>)?.nodeId)
        return (d.sourceRef as Record<string, unknown>).nodeId === node.id
      if ((d.thenRef as Record<string, unknown>)?.nodeId)
        return (d.thenRef as Record<string, unknown>).nodeId === node.id
      if ((d.ifRef as Record<string, unknown>)?.nodeId)
        return (d.ifRef as Record<string, unknown>).nodeId === node.id
      return false
    })
    .map(buildConstraintItemFromNode)
    .filter(Boolean) as ConstraintItemV2[]

  const embeddedConstraintIds = new Set(embeddedConstraintsFromChildren.map((c) => c.id))
  const embeddedConstraints = [
    ...embeddedConstraintsFromChildren,
    ...embeddedConstraintsLegacy.filter((c) => !embeddedConstraintIds.has(c.id)),
  ]

  const columnConstraints: Record<string, unknown>[] = []
  for (const col of data.columns || []) {
    const colConstraints = col.constraints
    if (!colConstraints) continue
    const colId = col.id || col.columnName

    if (colConstraints.notNull) {
      columnConstraints.push({
        id: `${colId}_notNull`,
        type: 'NotNull' as const,
        enabled: true,
        description: `NotNull constraint for ${col.columnName}`,
        column: col.columnName,
        params: {},
      })
    }

    if (colConstraints.unique) {
      columnConstraints.push({
        id: `${colId}_unique`,
        type: 'Unique' as const,
        enabled: true,
        description: `Unique constraint for ${col.columnName}`,
        column: col.columnName,
        params: {},
      })
    }

    if (
      colConstraints.allowedValues &&
      Array.isArray(colConstraints.allowedValues) &&
      colConstraints.allowedValues.length > 0
    ) {
      columnConstraints.push({
        id: `${colId}_allowedValues`,
        type: 'AllowedValues' as const,
        enabled: true,
        description: `AllowedValues constraint for ${col.columnName}`,
        column: col.columnName,
        params: { allowed_values: colConstraints.allowedValues.map(String) },
      })
    }
  }

  const allConstraints = [...embeddedConstraints, ...columnConstraints]

  const columns: ColumnSpecV2[] = flattenJsonColumns(data.columns || [])

  return {
    version: 2,
    id: node.id,
    name: data.tableName,
    source,
    columns,
    constraints: allConstraints as unknown as ConstraintItemV2[],
    script_checks: [],
  }
}

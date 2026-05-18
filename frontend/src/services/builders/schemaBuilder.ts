/**
 * @file schemaBuilder.ts
 * @description Schema 节点文件构建器
 *
 * 该模块负责将 Schema 节点数据构建为 .schema.yaml 文件格式，
 * 包含表结构定义、列信息、内嵌约束等。
 *
 * 功能：
 * 1. 构建 Schema 文件头部（版本、ID、表名）
 * 2. 构建数据源配置（文件路径、Sheet名、表头行）
 * 3. 构建列定义列表
 * 4. 收集并构建内嵌约束
 */

import type {
  CustomNode,
  SchemaNodeData,
  DataType,
  SchemaColumn,
  JsonSchemaNodeData,
  JsonSchemaColumn,
} from '@/types/graph'
import type {
  TableSchemaFileV2,
  ConstraintTypeV2,
  ConstraintItemV2,
  ColumnSpecV2,
  JSONOptionsV2,
} from '@/types/projectV2'
import { generateSchemaId } from '@/utils/typeHelpers'
import { isConstraintNodeType } from '@/services/constraints/validationRegistry'

/**
 * 数据类型转换：前端类型 → 后端类型
 * 当列绑定了 pattern 时，返回完整的类型配置对象
 */
export { generateSchemaId, extractSheetFromId, isExcelSchema } from '@/utils/typeHelpers'
export function toBackendType(
  dataType: DataType,
  column?: SchemaColumn
): string | Record<string, unknown> {
  // 如果列绑定了 regex pattern，返回完整配置对象
  // 只要有 boundPattern，就应该生成 Expr 类型配置，无论当前 dataType 是什么
  if (column?.boundPattern) {
    const typeConfig: Record<string, unknown> = {
      name: 'Expr',
      registry: column.boundRegistry || 'expression_registry',
    }
    // 如果有显式的 pattern，添加到配置中
    typeConfig.pattern = column.boundPattern
    return typeConfig
  }

  switch (dataType) {
    case 'String':
      return 'Str'
    case 'Integer':
      return 'Int'
    case 'Float':
      return 'Float'
    case 'Boolean':
      return 'Boolean'
    case 'Date':
      return 'Date'
    case 'Expression':
      return 'Expr'
    default:
      return 'Str'
  }
}

/**
 * 数据类型转换：后端类型 → 前端类型
 */
export function fromBackendType(typeConfig: unknown): DataType {
  if (typeof typeConfig === 'string') {
    if (typeConfig === 'Int') return 'Integer'
    if (typeConfig === 'Float') return 'Float'
    if (typeConfig === 'Str') return 'String'
    if (typeConfig === 'Boolean') return 'Boolean'
    if (typeConfig === 'Date') return 'Date'
    if (typeConfig === 'Expr' || typeConfig === 'CompositeExpr') return 'Expression'
  }
  return 'String'
}

/**
 * JSON 数据类型转换：前端 JsonDataType → 后端类型
 */
export function toJsonBackendType(dataType: string): string {
  switch (dataType) {
    case 'string':
      return 'Str'
    case 'number':
      return 'Float'
    case 'boolean':
      return 'Boolean'
    case 'object':
      return 'Str'
    case 'array':
      return 'Str'
    case 'null':
      return 'Str'
    default:
      return 'Str'
  }
}

/**
 * 构建 JSON 格式选项
 */
export function buildJSONOptions(data: JsonSchemaNodeData): JSONOptionsV2 | undefined {
  const options: JSONOptionsV2 = {}

  // format 字段
  if (data.format) {
    // 转换 'jsonl' 和 'ndjson' 为 'lines'
    options.format =
      data.format === 'jsonl' || data.format === 'ndjson'
        ? 'lines'
        : data.format === 'json'
          ? 'array'
          : 'auto'
  } else {
    options.format = 'auto'
  }

  // json_path 字段
  if (data.jsonPath) {
    options.json_path = data.jsonPath
  }

  // record_path 字段
  if (data.recordPath) {
    options.record_path = data.recordPath
  }

  // sep 字段（默认为 '.')
  options.sep = '.'

  return options
}

/**
 * 将约束节点转换为内嵌约束项格式
 *
 * 用于将连接在 Schema 上的约束节点转换为 schema.yaml 中的 constraints 数组项
 *
 * @param node - 约束节点
 * @param constraintTypeMap - 约束类型映射表
 * @returns 内嵌约束项对象，如果转换失败返回 null
 */
function buildConstraintItemFromNode(
  node: CustomNode,
  constraintTypeMap: Record<string, string>
): ConstraintItemV2 | null {
  const d = (node.data || {}) as Record<string, unknown>
  const v2Type = constraintTypeMap[node.type as string] as ConstraintTypeV2 | undefined
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
      params: { expression: d.script || '' },
    }
  }

  if (v2Type === 'Conditional') {
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      params: { then_condition: d.thenConditionConfig as string },
    }
  }

  // ========== 新增：范围约束 (Range) ==========
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

  // ========== 新增：字符集约束 (Charset) ==========
  if (v2Type === 'Charset') {
    return {
      id: node.id,
      type: v2Type,
      enabled: true,
      description: (d.configName as string) || undefined,
      column: d.column as string,
      params: {
        charset_mode: d.charsetMode || 'ascii',
      },
    }
  }

  // ========== 新增：日期逻辑约束 (DateLogic) ==========
  if (v2Type === 'DateLogic') {
    const params: Record<string, unknown> = {
      logic_mode: (d.logicMode as string) || 'compare',
    }

    if (d.logicMode === 'compare') {
      params.compare_op = (d.compareOp as string) || 'gt'
      if (d.referenceDate) {
        params.reference_date = d.referenceDate as string
      }
      if (d.referenceColumn) {
        params.reference_column = d.referenceColumn as string
      }
    } else {
      // calculation mode
      params.calculation_type = (d.calculationType as string) || 'age'
      if (d.targetValue) {
        params.target_value = d.targetValue as string
      }
      if (d.targetColumn) {
        params.target_column = d.targetColumn as string
      }
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

  // 默认处理其他约束类型
  return {
    id: node.id,
    type: v2Type,
    enabled: true,
    description: (d.configName as string) || undefined,
    params: {},
  }
}

/**
 * 根据表名和列名查找对应的节点和列 ID
 */
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

/**
 * 构建 V2 Schema 文件
 *
 * 将 Schema 节点或 JsonSchema 节点转换为后端可解析的 YAML 格式
 *
 * @param schemaNodeId - Schema 节点 ID
 * @param nodes - 图中所有节点
 * @returns Schema 文件对象
 *
 * @example
 * ```typescript
 * const schemaFile = buildV2SchemaFile('schema-1', nodes);
 * ```
 */
export function buildV2SchemaFile(schemaNodeId: string, nodes: CustomNode[]): TableSchemaFileV2 {
  // 支持普通 Schema 节点和 JSON Schema 节点
  const node = nodes.find(
    (n) => n.id === schemaNodeId && (n.type === 'schema' || n.type === 'jsonSchema')
  )
  if (!node) throw new Error('未找到Schema节点')

  const isJsonSchema = node.type === 'jsonSchema'

  // 如果是 JSON Schema 节点，调用专门的构建函数
  if (isJsonSchema) {
    return buildV2JsonSchemaFileInternal(node, nodes)
  }

  // 普通 Schema 节点的处理逻辑
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

  const constraintTypeMap: Record<string, string> = {
    foreignKeyConstraint: 'ForeignKey',
    uniqueConstraint: 'Unique',
    notNullConstraint: 'NotNull',
    allowedValuesConstraint: 'AllowedValues',
    conditionalConstraint: 'Conditional',
    scriptedConstraint: 'Scripted',
    rangeConstraint: 'Range',
    charsetConstraint: 'Charset',
    dateLogicConstraint: 'DateLogic',
  }

  /**
   * 从 Schema 的 children 数组中收集关联的约束节点，构建内嵌约束配置
   * children 数组在节点连接时维护（useConnections.ts 和 schemaOps.ts）
   */
  const childrenIds = (data as unknown as Record<string, unknown>).children as string[] | undefined

  const embeddedConstraintsFromChildren =
    childrenIds && childrenIds.length > 0
      ? (childrenIds
          .map((id) => nodes.find((n) => n.id === id))
          .filter((n): n is CustomNode => !!n && isConstraintNodeType(n.type))
          .map((n) => buildConstraintItemFromNode(n, constraintTypeMap))
          .filter(Boolean) as ConstraintItemV2[])
      : []

  /**
   * 保留原有逻辑：收集 embedded === true 的约束节点（向后兼容）
   * 注意：这部分可能在未来的重构中移除，建议统一使用 children 机制
   */
  const embeddedConstraintsLegacy = nodes
    .filter(
      (n) =>
        isConstraintNodeType(n.type) &&
        (n.data as unknown as Record<string, unknown>)?.embedded === true
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
    .map((n) => buildConstraintItemFromNode(n, constraintTypeMap))
    .filter(Boolean) as ConstraintItemV2[]

  // 合并来自 children 和 legacy 的内嵌约束，以 children 为准去重
  const embeddedConstraintIds = new Set(
    embeddedConstraintsFromChildren.map((c: ConstraintItemV2) => c.id)
  )
  const embeddedConstraints = [
    ...embeddedConstraintsFromChildren,
    ...embeddedConstraintsLegacy.filter((c: ConstraintItemV2) => !embeddedConstraintIds.has(c.id)),
  ]

  const columnConstraints: ConstraintItemV2[] = []
  for (const col of data.columns || []) {
    const colConstraints = col.constraints
    if (!colConstraints) continue

    // 使用 col.id 作为基础，如果不存在则回退到 columnName
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
    id: generateSchemaId(data.sourceFilePath || data.sourceFile || '', data.sheetName),
    name: data.tableName,
    source,
    columns: (data.columns || []).map((col) => {
      const columnDef: ColumnSpecV2 = {
        id: col.columnName,
        name: col.columnName,
        type: toBackendType(col.dataType, col),
        primary_key: false,
        expand: false,
      }
      // Extracted 类型列的配置
      if (col.extractedConfig) {
        columnDef.type = {
          name: 'Extracted',
          source_column: col.extractedConfig.sourceColumn,
          extract_key: col.extractedConfig.extractKey,
          result_type: col.extractedConfig.resultType || 'String',
        }
      }
      return columnDef
    }),
    constraints: allConstraints,
    script_checks: [],
  }
}

/**
 * 将树形的 JSON Schema 列展平为一维数组，供后端 YAML 存储
 */
export function flattenJsonColumns(
  columns: JsonSchemaColumn[],
  nameSet: Set<string> = new Set()
): ColumnSpecV2[] {
  const result: ColumnSpecV2[] = []

  for (const col of columns) {
    // 生成唯一的列名，防止嵌套对象中有同名字段导致后端校验失败
    let uniqueName = col.columnName
    let counter = 1
    while (nameSet.has(uniqueName)) {
      uniqueName = `${col.columnName}_${counter}`
      counter++
    }
    nameSet.add(uniqueName)

    const columnDef: ColumnSpecV2 = {
      id: col.id || uniqueName,
      name: uniqueName,
      type: col.boundPattern
        ? {
            name: 'Expr',
            registry: col.boundRegistry || 'expression_registry',
            pattern: col.boundPattern,
          }
        : toJsonBackendType(col.dataType),
      primary_key: col.primaryKey || false,
      expand: col.isExpanded || false,
    }

    if (col.jsonPath) {
      columnDef.json_path = col.jsonPath
    }

    result.push(columnDef)

    if (col.children && col.children.length > 0) {
      result.push(...flattenJsonColumns(col.children, nameSet))
    }
  }

  return result
}

/**
 * 内部函数：构建 JSON Schema 文件
 *
 * 将 JsonSchema 节点转换为后端可解析的 YAML 格式，包含 JSON 特有的 source options
 *
 * @param node - JsonSchema 节点
 * @param nodes - 图中所有节点
 * @returns Schema 文件对象
 */
function buildV2JsonSchemaFileInternal(node: CustomNode, nodes: CustomNode[]): TableSchemaFileV2 {
  const data = node.data as JsonSchemaNodeData

  // 构建 source 配置（包含 JSON options）
  const resolvedRelative = data.sourceFilePath
  const resolvedAbsolute = data.localPath

  // 构建 JSON options
  const jsonOptions = buildJSONOptions(data)

  const source =
    data.sourcePathMode === 'absolute_file'
      ? resolvedAbsolute
        ? {
            mode: 'absolute_file' as const,
            path: resolvedAbsolute,
            sheet: undefined, // JSON 没有 sheet
            header_row: data.headerRow || 0,
            options: jsonOptions,
          }
        : undefined
      : data.sourcePathMode === 'relative_file'
        ? resolvedRelative
          ? {
              mode: 'relative_file' as const,
              path: resolvedRelative,
              sheet: undefined, // JSON 没有 sheet
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

  // JSON Schema 不支持约束节点（目前），但保留空数组以保持格式一致
  const constraints: ConstraintItemV2[] = []

  // 将树形的 JSON Schema 列展平，同时处理重名和 json_path
  const columns: ColumnSpecV2[] = flattenJsonColumns(data.columns || [])

  return {
    version: 2,
    id: generateSchemaId(data.sourceFilePath || data.sourceFile || '', undefined),
    name: data.tableName,
    source,
    columns,
    constraints,
    script_checks: [],
  }
}

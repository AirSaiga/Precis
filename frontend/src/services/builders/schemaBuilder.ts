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

import type { DataType, SchemaColumn, JsonSchemaNodeData, JsonSchemaColumn } from '@/types/graph'
import type { ColumnSpecV2, JSONOptionsV2 } from '@/types/projectV2'

/**
 * 数据类型转换：前端类型 → 后端类型
 * 当列绑定了 pattern 时，返回完整的类型配置对象
 */
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
    const t = typeConfig.toLowerCase()
    if (t === 'int' || t === 'integer') return 'Integer'
    if (t === 'float') return 'Float'
    if (t === 'decimal') return 'Float'
    if (t === 'str' || t === 'string') return 'String'
    if (t === 'boolean' || t === 'bool') return 'Boolean'
    if (t === 'date' || t === 'datetime' || t === 'time') return 'Date'
    if (t === 'expr' || t === 'compositeexpr') return 'Expression'
    // JSON 类型映射到 String（Excel/CSV 类型系统中无直接等价类型）
    if (t === 'jsonobject' || t === 'json_object') return 'String'
    if (t === 'jsonarray' || t === 'json_array') return 'String'
    if (t === 'jsonnull' || t === 'json_null') return 'String'
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
      return 'JsonObject'
    case 'array':
      return 'JsonArray'
    case 'null':
      return 'JsonNull'
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
    options.format = data.format
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
 * 将树形的 JSON Schema 列转换为嵌套结构，供后端 YAML 存储
 * 保留父子关系，支持嵌套对象和数组
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

    if (col.nullable !== undefined) {
      columnDef.nullable = col.nullable
    }

    // 递归处理子列，保留嵌套结构
    if (col.children && col.children.length > 0) {
      columnDef.children = flattenJsonColumns(col.children, nameSet)
    }

    result.push(columnDef)
  }

  return result
}

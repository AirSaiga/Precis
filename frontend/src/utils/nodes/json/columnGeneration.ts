/**
 * @file columnGeneration.ts
 * @description JSON Schema 列生成工具函数
 *
 * 该模块负责从 JSON 数据生成 JsonSchemaColumn 列定义。
 * 支持递归遍历嵌套 JSON 结构，自动推断数据类型，并生成带有 JSONPath 的树形列定义。
 */

import type { JsonSchemaColumn, JsonDataType } from '@/types/nodes'

/**
 * 列生成配置选项
 */
export interface GenerateColumnsOptions {
  /**
   * 是否强制重新推断类型
   * 默认 false（保留现有列的类型）
   */
  forceReinferTypes?: boolean

  /**
   * 最大递归深度
   * 默认 5 层
   */
  maxDepth?: number
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `col_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * 推断单个值的 JSON 数据类型
 *
 * @param value - 要推断类型的值
 * @returns 推断出的 JsonDataType
 */
export function inferJsonDataType(value: unknown): JsonDataType {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  const jsType = typeof value

  switch (jsType) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    default:
      return 'string'
  }
}

/**
 * 合并多条记录的 key 结构
 */
export function mergeJsonStructure(records: unknown[]): Record<string, unknown> {
  if (!records || records.length === 0) {
    return {}
  }

  const merged: Record<string, unknown> = {}

  for (const record of records) {
    if (
      record === null ||
      record === undefined ||
      typeof record !== 'object' ||
      Array.isArray(record)
    ) {
      continue
    }

    const obj = record as Record<string, unknown>

    for (const key of Object.keys(obj)) {
      const existingValue = merged[key]
      const newValue = obj[key]

      if (existingValue === undefined || existingValue === null) {
        merged[key] = newValue
      } else if (
        typeof existingValue === 'object' &&
        !Array.isArray(existingValue) &&
        typeof newValue === 'object' &&
        !Array.isArray(newValue) &&
        newValue !== null
      ) {
        merged[key] = mergeJsonStructure([existingValue, newValue])
      }
    }
  }

  return merged
}

/**
 * 推断数组元素类型
 */
function inferArrayItemType(arr: unknown[]): JsonDataType {
  if (!arr || arr.length === 0) {
    return 'null'
  }

  const types = new Set<JsonDataType>()
  for (const item of arr) {
    const itemType = inferJsonDataType(item)
    if (itemType !== 'null') {
      types.add(itemType)
    }
  }

  if (types.size === 0) {
    return 'null'
  }

  if (types.size === 1) {
    return types.values().next().value
  }

  if (types.has('object')) {
    return 'object'
  }
  if (types.has('array')) {
    return 'array'
  }

  return types.values().next().value
}

/**
 * 从多条记录推断某个 key 的类型
 */
function inferTypeFromRecords(records: unknown[], key: string): JsonDataType {
  const types = new Set<JsonDataType>()

  for (const record of records) {
    if (
      record === null ||
      record === undefined ||
      typeof record !== 'object' ||
      Array.isArray(record)
    ) {
      continue
    }

    const obj = record as Record<string, unknown>
    if (key in obj) {
      const valueType = inferJsonDataType(obj[key])
      if (valueType !== 'null') {
        types.add(valueType)
      }
    }
  }

  if (types.size === 0) {
    return 'null'
  }

  if (types.size === 1) {
    return types.values().next().value
  }

  if (types.has('object')) {
    return 'object'
  }
  if (types.has('array')) {
    return 'array'
  }

  return types.values().next().value
}

/**
 * 获取代表性数组值
 */
function getRepresentativeArray(records: unknown[], key: string): unknown[] {
  for (const record of records) {
    if (
      record === null ||
      record === undefined ||
      typeof record !== 'object' ||
      Array.isArray(record)
    ) {
      continue
    }

    const obj = record as Record<string, unknown>
    const value = obj[key]

    if (Array.isArray(value) && value.length > 0) {
      return value
    }
  }

  return []
}

/**
 * 获取代表性对象值
 */
function getRepresentativeObject(records: unknown[], key: string): Record<string, unknown> {
  const objectValues: unknown[] = []

  for (const record of records) {
    if (
      record === null ||
      record === undefined ||
      typeof record !== 'object' ||
      Array.isArray(record)
    ) {
      continue
    }

    const obj = record as Record<string, unknown>
    const value = obj[key]

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      objectValues.push(value)
    }
  }

  return mergeJsonStructure(objectValues)
}

/**
 * 递归生成 JSON 列定义
 */
function generateColumnsRecursive(
  obj: Record<string, unknown>,
  parentPath: string,
  currentDepth: number,
  maxDepth: number,
  records: unknown[]
): JsonSchemaColumn[] {
  const columns: JsonSchemaColumn[] = []

  for (const key of Object.keys(obj)) {
    const jsonPath = parentPath === '$' ? `$.${key}` : `${parentPath}.${key}`
    const dataType = inferTypeFromRecords(records, key)

    const column: JsonSchemaColumn = {
      id: generateId(),
      columnName: key,
      jsonPath: jsonPath,
      dataType: dataType,
      nullable: true,
      isExpanded: false,
      constraints: {},
      validationErrors: [],
    }

    if (dataType === 'array') {
      const representativeArray = getRepresentativeArray(records, key)
      column.arrayItemType = inferArrayItemType(representativeArray)

      if (column.arrayItemType === 'object' && currentDepth < maxDepth) {
        const objectItems = representativeArray.filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === 'object' && !Array.isArray(item)
        )

        if (objectItems.length > 0) {
          const mergedItemStructure = mergeJsonStructure(objectItems)
          column.children = generateColumnsRecursive(
            mergedItemStructure,
            `${jsonPath}[*]`,
            currentDepth + 1,
            maxDepth,
            objectItems
          )
        }
      }
    }

    if (dataType === 'object' && currentDepth < maxDepth) {
      const representativeObj = getRepresentativeObject(records, key)

      if (Object.keys(representativeObj).length > 0) {
        const childRecords: unknown[] = []
        for (const record of records) {
          if (record !== null && typeof record === 'object' && !Array.isArray(record)) {
            const objRecord = record as Record<string, unknown>
            if (
              objRecord[key] !== null &&
              typeof objRecord[key] === 'object' &&
              !Array.isArray(objRecord[key])
            ) {
              childRecords.push(objRecord[key])
            }
          }
        }

        column.children = generateColumnsRecursive(
          representativeObj,
          jsonPath,
          currentDepth + 1,
          maxDepth,
          childRecords
        )
      }
    }

    columns.push(column)
  }

  return columns
}

/**
 * 构建列名到列定义的映射
 */
function buildColumnMap(columns: JsonSchemaColumn[], map: Map<string, JsonSchemaColumn>): void {
  for (const col of columns) {
    map.set(col.jsonPath, col)

    if (col.children && col.children.length > 0) {
      buildColumnMap(col.children, map)
    }
  }
}

/**
 * 合并新生成的列与现有列
 */
function mergeColumns(
  newColumns: JsonSchemaColumn[],
  existingMap: Map<string, JsonSchemaColumn>,
  forceReinferTypes: boolean
): JsonSchemaColumn[] {
  return newColumns.map((newCol) => {
    const existingCol = existingMap.get(newCol.jsonPath)

    if (existingCol) {
      const mergedCol: JsonSchemaColumn = {
        ...newCol,
        id: existingCol.id,
        nullable: existingCol.nullable ?? newCol.nullable,
        primaryKey: existingCol.primaryKey,
        description: existingCol.description,
        isExpanded: existingCol.isExpanded ?? newCol.isExpanded,
        constraints: existingCol.constraints ?? newCol.constraints,
      }

      if (!forceReinferTypes) {
        mergedCol.dataType = existingCol.dataType
        mergedCol.arrayItemType = existingCol.arrayItemType
      }

      if (newCol.children && newCol.children.length > 0) {
        mergedCol.children = mergeColumns(newCol.children, existingMap, forceReinferTypes)
      }

      return mergedCol
    }

    if (newCol.children && newCol.children.length > 0) {
      return {
        ...newCol,
        children: mergeColumns(newCol.children, existingMap, forceReinferTypes),
      }
    }

    return newCol
  })
}

/**
 * 从 JSON 源数据生成列定义
 *
 * @param rawData - JSON 原始数据数组
 * @param existingColumns - 现有的列定义数组
 * @param options - 配置选项
 * @returns 生成的 JsonSchemaColumn 数组
 */
export function generateJsonColumnsFromSource(
  rawData: unknown[],
  existingColumns: JsonSchemaColumn[] = [],
  options?: GenerateColumnsOptions
): JsonSchemaColumn[] {
  if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
    return existingColumns
  }

  const maxDepth = options?.maxDepth ?? 5
  const forceReinferTypes = options?.forceReinferTypes ?? false

  const mergedStructure = mergeJsonStructure(rawData)

  if (Object.keys(mergedStructure).length === 0) {
    return existingColumns
  }

  const newColumns = generateColumnsRecursive(mergedStructure, '$', 1, maxDepth, rawData)

  if (!existingColumns || existingColumns.length === 0) {
    return newColumns
  }

  const existingMap = new Map<string, JsonSchemaColumn>()
  buildColumnMap(existingColumns, existingMap)

  return mergeColumns(newColumns, existingMap, forceReinferTypes)
}

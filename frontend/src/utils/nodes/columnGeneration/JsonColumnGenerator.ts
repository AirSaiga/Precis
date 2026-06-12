/**
 * @file JsonColumnGenerator.ts
 * @description JSON 数据列生成策略
 *
 * 从 JSON 对象数组生成 JsonSchemaColumn 树形列定义，支持嵌套结构。
 */

import type { JsonSchemaColumn, JsonDataType } from '@/types/nodes'
import type { ColumnGenerationStrategy, ColumnComparisonResult } from './types'

interface JsonGenerateOptions {
  /** 是否强制重新推断类型 */
  forceReinferTypes?: boolean
  /** 最大递归深度 */
  maxDepth?: number
}

function generateId(): string {
  return `col_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

function inferJsonDataType(value: unknown): JsonDataType {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'

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

function inferArrayItemType(arr: unknown[]): JsonDataType {
  if (!arr || arr.length === 0) return 'null'

  const types = new Set<JsonDataType>()
  for (const item of arr) {
    const itemType = inferJsonDataType(item)
    if (itemType !== 'null') types.add(itemType)
  }

  if (types.size === 0) return 'null'
  if (types.size === 1) {
    const first = types.values().next().value
    if (first) return first
  }
  if (types.has('object')) return 'object'
  if (types.has('array')) return 'array'
  const first = types.values().next().value
  if (first) return first
  return 'null'
}

function mergeJsonStructure(records: unknown[]): Record<string, unknown> {
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
      if (valueType !== 'null') types.add(valueType)
    }
  }

  if (types.size === 0) return 'null'
  if (types.size === 1) {
    const first = types.values().next().value
    if (first) return first
  }
  if (types.has('object')) return 'object'
  if (types.has('array')) return 'array'
  const first = types.values().next().value
  if (first) return first
  return 'null'
}

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
    if (Array.isArray(value) && value.length > 0) return value
  }
  return []
}

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

function buildColumnMap(columns: JsonSchemaColumn[], map: Map<string, JsonSchemaColumn>): void {
  for (const col of columns) {
    map.set(col.jsonPath, col)
    if (col.children && col.children.length > 0) {
      buildColumnMap(col.children, map)
    }
  }
}

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

export class JsonColumnGenerator implements ColumnGenerationStrategy {
  /**
   * 从 JSON 数据生成列定义
   *
   * @param rawData - JSON 对象数组
   * @param existingColumns - 现有 JsonSchemaColumn 数组
   * @returns 生成的 JsonSchemaColumn 数组
   */
  generate(rawData: unknown, existingColumns: unknown[]): unknown[] {
    const records = rawData as unknown[]
    const existingCols = existingColumns as JsonSchemaColumn[]

    if (!records || !Array.isArray(records) || records.length === 0) {
      return existingCols
    }

    const options: JsonGenerateOptions = { forceReinferTypes: true, maxDepth: 5 }
    const mergedStructure = mergeJsonStructure(records)

    if (Object.keys(mergedStructure).length === 0) {
      return existingCols
    }

    const newColumns = generateColumnsRecursive(mergedStructure, '$', 1, options.maxDepth!, records)

    if (!existingCols || existingCols.length === 0) {
      return newColumns
    }

    const existingMap = new Map<string, JsonSchemaColumn>()
    buildColumnMap(existingCols, existingMap)

    return mergeColumns(newColumns, existingMap, options.forceReinferTypes!)
  }

  /**
   * 双向比较 JSON 字段与 Schema 列定义
   */
  compare(sourceFields: string[], existingColumns: unknown[]): ColumnComparisonResult {
    const schemaCols = existingColumns as JsonSchemaColumn[]
    const schemaEmpty = schemaCols.length === 0

    if (schemaEmpty) {
      return {
        schemaEmpty: true,
        newInSource: [],
        staleInSchema: [],
        isMatch: false,
        needsAction: true,
      }
    }

    const sourceSet = new Set(sourceFields)
    const schemaNameSet = new Set(schemaCols.map((c) => c.columnName.trim()))

    const newInSource = sourceFields.filter((name) => !schemaNameSet.has(name))

    const staleInSchema = schemaCols
      .filter((col) => {
        if (sourceSet.has(col.columnName.trim())) return false
        const isDerived = col.expressionType === 'implicit' || col.expressionType === 'explicit'
        const isBound = col.isBound === true
        const isExtracted = !!col.extractedConfig
        return !(isDerived || isBound || isExtracted)
      })
      .map((c) => c.columnName.trim())

    const isMatch = newInSource.length === 0

    return {
      schemaEmpty: false,
      newInSource,
      staleInSchema,
      isMatch,
      needsAction: !isMatch,
    }
  }

  /**
   * 从预览数据中提取 JSON 字段名
   */
  extractSourceFields(previewData: Record<string, unknown>): string[] | undefined {
    const rawData = previewData.raw_data as unknown[] | undefined
    if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return undefined

    const firstRecord = rawData[0]
    if (!firstRecord || typeof firstRecord !== 'object' || Array.isArray(firstRecord))
      return undefined

    return Object.keys(firstRecord as Record<string, unknown>)
  }
}

/** 默认实例 */
export const jsonColumnGenerator = new JsonColumnGenerator()

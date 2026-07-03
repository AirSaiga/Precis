/**
 * @file columnGeneration.ts
 * @description JSON Schema 列生成编排函数（连接流程专用）
 *
 * 定位说明：
 * 本文件提供 generateJsonColumnsFromSource，是「数据源连接 / 智能填充」流程的列生成入口，
 * 支持 forceReinferTypes / maxDepth 等编排选项（默认保留现有列类型）。
 *
 * 与 columnGeneration/JsonColumnGenerator.ts 的关系：
 * - JsonColumnGenerator（策略类，实现 ColumnGenerationStrategy）：供键盘绑定 / 生成 schema 等
 *   场景通过统一策略接口调用，硬编码 forceReinferTypes=true。
 * - generateJsonColumnsFromSource（本文件）：供连接处理器 / 源管理器调用，保留 options 灵活性。
 * 两者并行、各司其职，不存在废弃迁移关系。
 */

import type { JsonSchemaColumn, JsonDataType } from '@/types/nodes'
// inferJsonDataType / inferArrayItemType / mergeJsonStructure 单一定义在 ./jsonColumnCore
// 此处 re-export inferJsonDataType / mergeJsonStructure 保持 barrel (composables/nodes/json/index.ts)
// 的对外契约不变;inferArrayItemType 仅内部使用。
export { inferJsonDataType, mergeJsonStructure } from './jsonColumnCore'
import { inferJsonDataType, inferArrayItemType, mergeJsonStructure } from './jsonColumnCore'

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
    const first = types.values().next().value
    if (first) return first
  }

  if (types.has('object')) {
    return 'object'
  }
  if (types.has('array')) {
    return 'array'
  }

  const first = types.values().next().value
  if (first) return first
  return 'null'
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

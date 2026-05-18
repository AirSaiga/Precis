/**
 * @file typeInference.ts
 * @description JSON 数据类型推断工具模块
 * 提供标准化的 JSON 数据类型推断功能
 */

import type { JsonDataType } from '@/types/nodes'

/**
 * 从单个值推断 JSON 数据类型
 *
 * @param value - 要推断的单元格值
 * @returns 推断的数据类型
 */
export function inferDataType(value: unknown): JsonDataType {
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
 * 从数据样本中推断列的主要数据类型
 * 使用多数投票策略，选择出现次数最多的类型
 *
 * @param columnData - 列数据数组
 * @returns 推断的数据类型
 */
export function inferColumnType(columnData: unknown[]): JsonDataType {
  if (!columnData || columnData.length === 0) {
    return 'string'
  }

  const typeCounts: Record<JsonDataType, number> = {
    string: 0,
    number: 0,
    boolean: 0,
    array: 0,
    object: 0,
    null: 0,
  }

  for (const value of columnData) {
    const type = inferDataType(value)
    typeCounts[type]++
  }

  let maxCount = 0
  let dominantType: JsonDataType = 'string'

  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > maxCount) {
      maxCount = count
      dominantType = type as JsonDataType
    }
  }

  return dominantType
}

/**
 * 推断嵌套对象结构
 *
 * @param value - 要推断的对象值
 * @returns 对象结构描述
 */
export function inferObjectStructure(value: unknown): Record<string, JsonDataType> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const structure: Record<string, JsonDataType> = {}

  for (const [key, val] of Object.entries(value)) {
    structure[key] = inferDataType(val)
  }

  return structure
}

/**
 * 推断数组元素类型
 *
 * @param arr - 要分析的数组
 * @returns 数组元素类型
 */
export function inferArrayItemType(arr: unknown[]): JsonDataType {
  if (!arr || arr.length === 0) {
    return 'null'
  }

  const types = new Set<JsonDataType>()

  for (const item of arr) {
    const type = inferDataType(item)
    if (type !== 'null') {
      types.add(type)
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
 * 检查值是否符合指定类型
 *
 * @param value - 要检查的值
 * @param expectedType - 期望的类型
 * @returns 是否符合
 */
export function isValueOfType(value: unknown, expectedType: JsonDataType): boolean {
  const actualType = inferDataType(value)
  return actualType === expectedType
}

/**
 * 获取类型的显示名称
 *
 * @param type - JSON 数据类型
 * @returns 显示名称
 */
export function getTypeDisplayName(type: JsonDataType): string {
  const typeMap: Record<JsonDataType, string> = {
    string: 'String',
    number: 'Number',
    boolean: 'Boolean',
    array: 'Array',
    object: 'Object',
    null: 'Null',
  }

  return typeMap[type] || type
}

/**
 * 获取类型的颜色标识
 *
 * @param type - JSON 数据类型
 * @returns 颜色代码
 */
export function getTypeColor(type: JsonDataType): string {
  const colorMap: Record<JsonDataType, string> = {
    string: '#4caf50',
    number: '#2196f3',
    boolean: '#ff9800',
    array: '#9c27b0',
    object: '#607d8b',
    null: '#9e9e9e',
  }

  return colorMap[type] || '#9e9e9e'
}

export default {
  inferDataType,
  inferColumnType,
  inferObjectStructure,
  inferArrayItemType,
  isValueOfType,
  getTypeDisplayName,
  getTypeColor,
}

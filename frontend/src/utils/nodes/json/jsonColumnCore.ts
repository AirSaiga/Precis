/**
 * @file jsonColumnCore.ts
 * @description JSON 列生成共享纯函数
 *
 * 定位说明：
 * 这些函数被两套 JSON 列生成实现共用：
 * - columnGeneration/JsonColumnGenerator.ts（策略类，键盘路径）
 * - json/columnGeneration.ts（编排函数，连接流程）
 * 两套实现并行、各司其职（见各文件头说明），但底层类型推断与结构合并逻辑相同，
 * 故抽到此单一定义点，避免重复漂移。
 */

import type { JsonDataType } from '@/types/nodes'

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
 * 推断数组元素类型
 *
 * 遍历数组所有非 null 元素的类型，按优先级返回代表性类型。
 */
export function inferArrayItemType(arr: unknown[]): JsonDataType {
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
 * 合并多条记录的 key 结构
 *
 * 将多条 JSON 记录的字段结构深度合并为一个代表整体结构的对象。
 * 嵌套对象递归合并；null 值不作为 object 参与合并（防止 null 被误并）。
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

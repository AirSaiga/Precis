/**
 * @file typeInference.ts
 * @description 统一数据类型推断工具模块
 * 提供标准化的数据类型推断功能
 */

import type { DataType } from '@/types/graph'

/**
 * 从单个值推断数据类型
 * 支持：Integer、Float、Boolean、Date、String
 *
 * @param value - 要推断的单元格值
 * @returns 推断的数据类型
 */
export function inferDataType(value: unknown): DataType {
  if (value === null || value === undefined || value === '') {
    return 'String'
  }

  const strValue = String(value).trim()

  if (/^\d+$/.test(strValue)) {
    return 'Integer'
  } else if (/^\d*\.\d+$/.test(strValue)) {
    return 'Float'
  } else if (/^(true|false|是|否)$/i.test(strValue)) {
    return 'Boolean'
  } else if (/^\d{4}-\d{2}-\d{2}/.test(strValue)) {
    return 'Date'
  }

  return 'String'
}

/**
 * 从数据样本中推断列的主要数据类型
 * 使用多数投票策略，选择出现次数最多的类型
 *
 * @param columnData - 列数据数组
 * @returns 推断的数据类型
 */
export function inferColumnType(columnData: unknown[]): DataType {
  if (!columnData || columnData.length === 0) {
    return 'String'
  }

  const typeCounts: Record<DataType, number> = {
    String: 0,
    Integer: 0,
    Float: 0,
    Decimal: 0,
    Boolean: 0,
    Date: 0,
    Expression: 0,
  }

  columnData.forEach((value) => {
    const type = inferDataType(value)
    typeCounts[type]++
  })

  let maxCount = 0
  let dominantType: DataType = 'String'

  for (const [type, count] of Object.entries(typeCounts)) {
    if (count > maxCount) {
      maxCount = count
      dominantType = type as DataType
    }
  }

  return dominantType
}

export default {
  inferDataType,
  inferColumnType,
}

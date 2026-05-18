/**
 * @file columnValidation.ts
 * @description 列验证工具模块
 * 提供列不匹配检查等验证功能
 */

import type { SchemaColumn } from '@/types/graph'

/**
 * 获取缺失的列名
 * 比较 Schema 定义和数据源表头，返回数据源中不存在的列名
 *
 * @param sourceColumns - 数据源列名数组
 * @param schemaColumns - Schema 列定义数组
 * @returns 缺失的列名数组
 */
export function findMissingColumns(
  sourceColumns: string[],
  schemaColumns: SchemaColumn[]
): string[] {
  if (schemaColumns.length === 0) return []

  return schemaColumns
    .map((c) => c.columnName)
    .filter((name: string) => !sourceColumns.includes(name))
}

/**
 * 从表头数据提取列名数组
 *
 * @param headerRow - 表头行数据
 * @returns 列名数组
 */
export function extractColumnNamesFromHeader(headerRow: unknown[]): string[] {
  if (!headerRow || headerRow.length === 0) return []
  return headerRow.map((h) => String(h).trim())
}

/**
 * 检查数据源列名与 Schema 定义是否匹配
 * 返回缺失列的信息，不执行 UI 操作
 *
 * @param sourceHeaderRow - 数据源表头行数据
 * @param schemaColumns - Schema 列定义数组
 * @returns 包含缺失列信息的对象，如果没有缺失则返回 null
 */
export interface ColumnMismatchResult {
  missingColumns: string[]
  missingCount: number
  previewMissing: string
  hasMore: boolean
}

export function checkColumnMatch(
  sourceHeaderRow: unknown[],
  schemaColumns: SchemaColumn[]
): ColumnMismatchResult | null {
  if (!sourceHeaderRow || sourceHeaderRow.length === 0) return null
  if (schemaColumns.length === 0) return null

  const sourceColumns = extractColumnNamesFromHeader(sourceHeaderRow)
  const missingColumns = findMissingColumns(sourceColumns, schemaColumns)

  if (missingColumns.length === 0) return null

  const missingCount = missingColumns.length
  const previewMissing = missingColumns.slice(0, 5).join(', ')
  const hasMore = missingColumns.length > 5

  return {
    missingColumns,
    missingCount,
    previewMissing,
    hasMore,
  }
}

export default {
  findMissingColumns,
  extractColumnNamesFromHeader,
  checkColumnMatch,
}

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

/**
 * 双向列比较结果
 * 用于智能列填充弹窗的决策判断
 */
export interface ColumnComparisonResult {
  /** Schema 是否无列定义 */
  schemaEmpty: boolean
  /** 数据源有但 Schema 没有的列名（正向差异） */
  newInSource: string[]
  /** Schema 有但数据源没有的非衍生列名（反向差异，排除衍生/绑定/提取列） */
  staleInSchema: string[]
  /** 所有源列是否都存在于 Schema 中 */
  isMatch: boolean
  /** 是否需要用户介入（!isMatch） */
  needsAction: boolean
}

/** compareColumns 的 schemaColumns 参数类型（SchemaColumn 和 JsonSchemaColumn 均兼容） */
interface ComparableColumn {
  columnName: string
  expressionType?: string
  isBound?: boolean
  extractedConfig?: unknown
}

/**
 * 双向比较数据源列名与 Schema 列定义
 * 用于智能列填充弹窗的三分支决策：空列生成 / 不匹配修正 / 完全匹配跳过
 *
 * @param sourceColumnNames - 已提取好的数据源列名数组
 * @param schemaColumns - Schema 列定义数组（SchemaColumn 或 JsonSchemaColumn 均可）
 * @returns 结构化的比较结果
 */
export function compareColumns(
  sourceColumnNames: string[],
  schemaColumns: ComparableColumn[]
): ColumnComparisonResult {
  const schemaEmpty = schemaColumns.length === 0

  if (schemaEmpty) {
    return { schemaEmpty: true, newInSource: [], staleInSchema: [], isMatch: false, needsAction: true }
  }

  const sourceSet = new Set(sourceColumnNames)
  const schemaNameSet = new Set(schemaColumns.map((c) => c.columnName.trim()))

  // 正向差异：数据源有但 Schema 没有的列
  const newInSource = sourceColumnNames.filter((name) => !schemaNameSet.has(name))

  // 反向差异：Schema 有但数据源没有的非衍生列
  const staleInSchema = schemaColumns
    .filter((col) => {
      if (sourceSet.has(col.columnName.trim())) return false
      // 排除衍生列、绑定列、提取列——这些列不在数据源中是正常的
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

export default {
  findMissingColumns,
  extractColumnNamesFromHeader,
  checkColumnMatch,
  compareColumns,
}

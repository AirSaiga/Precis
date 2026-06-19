/**
 * @file columnFinder.ts
 * @description JSON Schema 嵌套列树操作工具
 *
 * 提供递归查找和更新函数，支持在具有 children 的嵌套 JSON 列树中定位和修改列。
 */

import type { JsonSchemaColumn } from '@/types/graph'

export interface JsonColumnFindResult {
  column: JsonSchemaColumn
  parentArray: JsonSchemaColumn[]
  index: number
}

/**
 * 在嵌套 JSON 列树中递归查找指定 ID 的列。
 *
 * @param columns - 顶层列数组
 * @param columnId - 目标列 ID
 * @returns 查找到的列及其位置信息；未找到返回 null
 */
export function findJsonSchemaColumnById(
  columns: JsonSchemaColumn[] | undefined,
  columnId: string
): JsonColumnFindResult | null {
  if (!columns) return null

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    if (!col) continue
    if (col.id === columnId) {
      return { column: col, parentArray: columns, index: i }
    }
    if (col.children && col.children.length > 0) {
      const result = findJsonSchemaColumnById(col.children, columnId)
      if (result) return result
    }
  }
  return null
}

/**
 * 递归更新嵌套 JSON 列树中的每一列。
 *
 * 对树中每个节点应用 updater 函数，如果更新后的列有 children 则继续递归。
 *
 * @param columns - 顶层列数组
 * @param updater - 列转换函数
 * @returns 更新后的新列数组
 */
export function updateJsonSchemaColumnsRecursive(
  columns: JsonSchemaColumn[],
  updater: (col: JsonSchemaColumn) => JsonSchemaColumn
): JsonSchemaColumn[] {
  return columns.map((col) => {
    const updated = updater(col)
    if (updated.children && updated.children.length > 0) {
      return {
        ...updated,
        children: updateJsonSchemaColumnsRecursive(updated.children, updater),
      }
    }
    return updated
  })
}

/**
 * 从 JSON 对象数组中提取指定字段的非空唯一值。
 *
 * 用于外键校验等场景，从目标数据源中提取参照值列表。
 * 内置 50000 条上限防止内存溢出。
 *
 * @param rawData - JSON 对象数组
 * @param targetColumnName - 目标字段名
 * @returns 去重后的非空字符串值数组
 */
export function extractJsonTargetValues(rawData: unknown[], targetColumnName: string): string[] {
  if (!Array.isArray(rawData) || rawData.length === 0) return []

  const values = new Set<string>()
  for (const record of rawData) {
    if (record && typeof record === 'object' && !Array.isArray(record)) {
      const raw = (record as Record<string, unknown>)[targetColumnName]
      const v = raw === null || raw === undefined ? '' : String(raw).trim()
      if (v) values.add(v)
    }
    if (values.size > 50000) break
  }
  return Array.from(values)
}

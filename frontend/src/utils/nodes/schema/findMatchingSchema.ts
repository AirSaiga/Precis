/**
 * @file findMatchingSchema.ts
 * @description 从 V2 schema 配置中查找匹配指定数据源(table)的 schema。
 *
 * 匹配键:path + sheet(Excel 需 sheet 精确/模糊匹配)。
 * 与 json 版 findMatchingJsonSchema(按 path + recordPath)对应。
 */

import type { TableSchemaFileV2 } from '@/types/projectV2'
import { normalizePath, resolveRelativePath } from '@/core/utils/pathNormalization'

export function findMatchingSchema(
  schemas: Record<string, TableSchemaFileV2>,
  localPath: string,
  sheetName: string | undefined | null,
  configDir: string
): { id: string; schema: TableSchemaFileV2 } | null {
  const normLocal = normalizePath(localPath)
  const normSheet = (sheetName || '').trim().toLowerCase()

  // 第一轮：精确匹配（路径 + sheet）
  for (const [id, schema] of Object.entries(schemas)) {
    const srcPath = schema.source?.path
    if (!srcPath) continue

    const absPath = resolveRelativePath(srcPath, configDir) ?? srcPath
    const normAbs = normalizePath(absPath)
    if (normAbs !== normLocal) continue

    const isExcel = /\.(xlsx|xls)$/i.test(srcPath)
    if (isExcel) {
      const schemaSheet = (schema.source?.sheet ?? schema.sheet ?? '').trim().toLowerCase()
      if (schemaSheet === normSheet) return { id, schema }
    } else {
      return { id, schema }
    }
  }

  // 第二轮：模糊匹配（仅路径，忽略 sheet，针对 Excel schema）
  // 用于处理以下场景：
  // 1. schema 配置中未明确指定 sheet 名称
  // 2. sourcePreview 的 currentSheet 为空，但 schema 配置中有 sheet 名称
  for (const [id, schema] of Object.entries(schemas)) {
    const srcPath = schema.source?.path
    if (!srcPath) continue
    if (!/\.(xlsx|xls)$/i.test(srcPath)) continue

    const absPath = resolveRelativePath(srcPath, configDir) ?? srcPath
    const normAbs = normalizePath(absPath)
    if (normAbs !== normLocal) continue

    const schemaSheet = (schema.source?.sheet ?? schema.sheet ?? '').trim()
    // 接受未指定 sheet 的 schema，或当传入的 sheetName 为空时接受任何 sheet
    if (!schemaSheet || !sheetName) return { id, schema }
  }

  return null
}

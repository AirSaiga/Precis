/**
 * @file findMatchingJsonSchema.ts
 * @description 从 V2 schema 配置中查找匹配指定 JSON 数据源的 schema。
 *
 * 匹配键:path(规范化比较)+ recordPath(若 schema 配置了 record_path 则需一致)。
 * 与 table 版 findMatchingSchema(按 path + sheet)对应。
 */

import type { JSONOptionsV2, TableSchemaFileV2 } from '@/types/projectV2'
import { normalizePath, resolveRelativePath } from '@/core/utils/pathNormalization'

/** 类型守卫:判断 options 是否为 JSONOptionsV2(含 record_path) */
function isJsonOptions(options: unknown): options is JSONOptionsV2 {
  return typeof options === 'object' && options !== null && 'record_path' in options
}

export function findMatchingJsonSchema(
  schemas: Record<string, TableSchemaFileV2>,
  localPath: string,
  recordPath: string | undefined | null,
  configDir: string
): { id: string; schema: TableSchemaFileV2 } | null {
  const normLocal = normalizePath(localPath)

  for (const [id, schema] of Object.entries(schemas)) {
    const srcPath = schema.source?.path
    if (!srcPath) continue

    const absPath = resolveRelativePath(srcPath, configDir) ?? srcPath
    if (normalizePath(absPath) !== normLocal) continue

    // 路径匹配后,若 schema 配置了 record_path,则需 recordPath 一致
    const options = schema.source?.options
    const schemaRecordPath = isJsonOptions(options) ? options.record_path : undefined
    if (schemaRecordPath) {
      if (!recordPath || schemaRecordPath !== recordPath) continue
    }

    return { id, schema }
  }

  return null
}

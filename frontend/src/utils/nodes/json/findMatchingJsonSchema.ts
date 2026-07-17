/**
 * @file findMatchingJsonSchema.ts
 * @description 从 V2 schema 配置中查找匹配指定 JSON 数据源的 schema。
 *
 * 匹配键:
 * - path(规范化比较,必须匹配)
 * - recordPath(仅当 schema 配置了 record_path 时才需一致;未配置则只按 path 匹配)
 * 与 table 版 findMatchingSchema(按 path + sheet)对应。
 *
 * 注:format 不参与匹配。同一 JSON 文件配不同 format 的 schema 罕见,
 * 故有意不校验 format 一致性（D8 后 format 必须显式指定为 array/lines/object）。
 */

import type { TableSchemaFileV2 } from '@/types/projectV2'
import { normalizePath, resolveRelativePath } from '@/core/utils/pathNormalization'

/** 安全读取 options 上可能存在的 record_path(不依赖联合类型判定) */
function getRecordPath(options: unknown): string | undefined {
  if (typeof options !== 'object' || options === null) return undefined
  const val = (options as Record<string, unknown>).record_path
  return typeof val === 'string' ? val : undefined
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

    // 路径匹配后,若 schema 配置了 record_path,则需传入的 recordPath 与之一致
    const schemaRecordPath = getRecordPath(schema.source?.options)
    if (schemaRecordPath) {
      if (!recordPath || schemaRecordPath !== recordPath) continue
    }

    return { id, schema }
  }

  return null
}

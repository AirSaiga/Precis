/**
 * @file regexExtractUtils.ts
 * @description Regex Extract 模式的纯工具函数
 *
 * 这些函数原本内嵌在 useRegexValidation.ts 的 performRegexValidation 中，
 * 因不依赖组合式函数的闭包状态，提取为独立模块级函数以提高可维护性。
 */

/**
 * 确保列名唯一
 *
 * 如果候选列名已存在于 existing 集合中，追加 _suffix_n 后缀直到唯一。
 *
 * @param baseNames - 原始列名列表
 * @param existing - 已有列名集合（会被修改）
 * @param suffix - 后缀标识（如正则节点 ID 前 6 位）
 * @returns 去重后的列名列表
 */
export function ensureUniqueColumnNames(
  baseNames: string[],
  existing: Set<string>,
  suffix: string
): string[] {
  const resolved: string[] = []
  for (const base of baseNames) {
    const candidate = String(base).trim() || 'field'
    if (!existing.has(candidate)) {
      existing.add(candidate)
      resolved.push(candidate)
      continue
    }
    let i = 1
    while (existing.has(`${candidate}_${suffix}_${i}`)) i++
    const unique = `${candidate}_${suffix}_${i}`
    existing.add(unique)
    resolved.push(unique)
  }
  return resolved
}

/**
 * 移除由指定正则节点生成的派生列
 *
 * 从 SourcePreview 节点数据中清理该正则节点之前生成的派生列，
 * 返回清理后的数据以及被移除的列名列表。
 *
 * @param currentData - SourcePreview 节点数据
 * @param regexNodeId - 正则节点 ID
 * @param headerRowIndex - 表头行索引
 * @returns { data, removedColumnNames }
 */
export function removeDerivedColumns(
  currentData: Record<string, unknown>,
  regexNodeId: string,
  headerRowIndex: number
): { data: Record<string, unknown>; removedColumnNames: string[] } {
  const derivedColumnsByRegex = currentData.derivedColumnsByRegex as
    | Record<string, { columnNames?: string[] }>
    | undefined
  const derivedInfo = derivedColumnsByRegex?.[regexNodeId]
  const columnNames: string[] = Array.isArray(derivedInfo?.columnNames)
    ? derivedInfo.columnNames
    : []
  if (columnNames.length === 0) return { data: currentData, removedColumnNames: [] }

  const header = ((currentData.data as unknown[][])?.[headerRowIndex] || []).map((v) =>
    String(v ?? '').trim()
  )
  const indicesToRemove = columnNames
    .map((name) => header.findIndex((h) => h === String(name).trim()))
    .filter((i) => i >= 0)
    .sort((a, b) => b - a)

  if (indicesToRemove.length === 0) return { data: currentData, removedColumnNames: [] }

  const nextMatrix = ((currentData.data as unknown[][]) || []).map((row) => {
    const nextRow = Array.isArray(row) ? [...row] : []
    for (const idx of indicesToRemove) {
      nextRow.splice(idx, 1)
    }
    return nextRow
  })

  const next = {
    ...currentData,
    data: nextMatrix,
  } as Record<string, unknown>

  const nextDerived = { ...((next.derivedColumnsByRegex as Record<string, unknown>) || {}) }
  delete nextDerived[regexNodeId]
  next.derivedColumnsByRegex = nextDerived
  return { data: next, removedColumnNames: columnNames }
}

/**
 * 解析正则表达式中的 Python 风格命名捕获组
 *
 * @param pattern - 正则表达式模式字符串
 * @returns 捕获组名称列表
 */
export function parseNamedGroups(pattern: string): string[] {
  if (!pattern) return []
  return [...pattern.matchAll(/\(\?P<(\w+)>/g)].map((m) => m[1] || '')
}

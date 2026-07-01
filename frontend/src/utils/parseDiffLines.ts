/**
 * @file parseDiffLines.ts
 * @description 解析 unified diff 字符串为结构化行数组
 *
 * 将纯文本 diff 解析为带类型的行，用于 ApplyConfirmCard 的行级着色。
 * 支持标准 unified diff 格式：
 * - 以 '+' 开头 → 新增行
 * - 以 '-' 开头 → 删除行
 * - 其他 → 上下文行
 */

export type DiffLineType = 'add' | 'delete' | 'context' | 'meta'

export interface DiffLine {
  type: DiffLineType
  content: string
  /** 原始行号（可选，用于高级显示） */
  oldLine?: number
  newLine?: number
}

/** 判断是否为 diff 元信息行（文件头 ---/+++ 或 hunk 标记 @@） */
function isMetaLine(line: string): boolean {
  // hunk 标记:@@ ... @@
  if (line.startsWith('@@')) return true
  // 文件头:--- / +++ (后跟路径,如 a/file.ts、b/file.ts,或 /dev/null)
  // 仅当以 '--- ' 或 '+++ ' 开头(带空格)时视为文件头;
  // 避免 "--- 普通删除内容" 这类被误判(它以 '---' 开头但后面是内容)
  if (line.startsWith('--- ') || line.startsWith('+++ ')) return true
  return false
}

/**
 * 解析 unified diff 字符串为结构化行数组
 *
 * @param diff - unified diff 格式的字符串
 * @returns 解析后的行数组
 *
 * @example
 * ```ts
 * const lines = parseDiffLines('@@ -1,3 +1,4 @@\n line1\n+new line\n-old line\n line2')
 * // [
 * //   { type: 'meta', content: '@@ -1,3 +1,4 @@' },
 * //   { type: 'context', content: ' line1' },
 * //   { type: 'add', content: '+new line' },
 * //   { type: 'delete', content: '-old line' },
 * //   { type: 'context', content: ' line2' },
 * // ]
 * ```
 */
export function parseDiffLines(diff: string): DiffLine[] {
  if (!diff) return []

  return diff.split('\n').map((line) => {
    // 元信息行(文件头/hunk 标记)优先于 +/- 判断,避免被染成增删色
    if (isMetaLine(line)) {
      return { type: 'meta', content: line }
    }
    if (line.startsWith('+')) {
      return { type: 'add', content: line }
    }
    if (line.startsWith('-')) {
      return { type: 'delete', content: line }
    }
    return { type: 'context', content: line }
  })
}

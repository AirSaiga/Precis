/**
 * @file useConflictDiffEngine.ts
 * @description 冲突差异计算引擎组合式函数
 *
 * 功能概述:
 * - 将对象扁平化为键值对列表，用于逐行对比
 * - 计算原始配置与生成配置之间的差异行
 * - 提供 YAML 渲染、变更高亮等辅助函数
 *
 * 架构设计:
 * - flattenObject: 递归扁平化任意对象，保留缩进和路径信息
 * - formatValue: 统一格式化值为字符串表示
 * - diffLines computed: 根据当前选中的冲突项，生成左右两侧的 DiffLine 列表
 * - highlightChanges: 将变更内容包装为高亮 HTML
 *
 * 输入示例:
 *   const { diffLines, highlightChanges } = useConflictDiffEngine(selectedItem)
 *
 * 输出示例:
 *   diffLines.value.original -> DiffLine[]
 *   highlightChanges('name: Alice', changes) -> 'name: <span class="highlight-added">Alice</span>'
 */

import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { ConfigItemDiff } from '@/api/types/conflict'

export interface DiffLine {
  content: string
  type: 'unchanged' | 'added' | 'removed' | 'modified'
  prefix: string
  changes?: { key: string; oldValue: unknown; newValue: unknown }[]
  keyPath?: string
}

export interface FlatKeyValue {
  key: string
  value: unknown
  indent: number
  path: string[]
}

/**
 * 递归扁平化任意对象，生成带缩进和路径信息的键值对列表
 *
 * 用于将嵌套对象转换为适合逐行对比的平面结构。
 * 数组项以 `- [index]` 或 `-` 前缀标识，对象属性保留原始键名。
 *
 * @param obj - 要扁平化的对象
 * @param prefix - 当前键名前缀（递归使用）
 * @param indent - 当前缩进层级（递归使用）
 * @param path - 当前属性路径数组（递归使用）
 * @returns 扁平化后的键值对列表
 */
export const flattenObject = (
  obj: unknown,
  prefix = '',
  indent = 0,
  path: string[] = []
): FlatKeyValue[] => {
  const result: FlatKeyValue[] = []
  if (obj === null || obj === undefined) {
    result.push({ key: prefix || '(null)', value: null, indent, path })
    return result
  }
  if (typeof obj !== 'object') {
    result.push({ key: prefix, value: obj, indent, path })
    return result
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      const itemPath = [...path, String(idx)]
      if (typeof item === 'object' && item !== null) {
        result.push({ key: `- [${idx}]`, value: '', indent, path: itemPath })
        result.push(...flattenObject(item, '', indent + 2, itemPath))
      } else {
        result.push({ key: `-`, value: item, indent, path: itemPath })
      }
    })
    return result
  }
  Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => {
    const itemPath = [...path, k]
    if (typeof v === 'object' && v !== null) {
      result.push({ key: k, value: '', indent, path: itemPath })
      result.push(...flattenObject(v, k, indent + 2, itemPath))
    } else {
      result.push({ key: k, value: v, indent, path: itemPath })
    }
  })
  return result
}

/**
 * 将任意值格式化为字符串表示
 *
 * 处理规则：null/undefined → 'null'，boolean → 'true'/'false'，
 * number/string 保持原样，其他类型使用 JSON.stringify。
 *
 * @param value - 要格式化的值
 * @returns 格式化后的字符串
 */
export const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * 将对象渲染为类 YAML 格式的字符串
 *
 * 使用缩进和 `-` / `key: value` 语法模拟 YAML 结构，
 * 用于在预览模态框中展示配置内容的可读形式。
 *
 * @param obj - 要渲染的对象
 * @returns 类 YAML 字符串
 */
export const renderYaml = (obj: unknown): string => {
  const lines: string[] = []
  const render = (o: unknown, indent: number = 0) => {
    if (o === null || o === undefined) {
      lines.push(' '.repeat(indent) + 'null')
    } else if (typeof o === 'object') {
      if (Array.isArray(o)) {
        if (o.length === 0) {
          lines.push(' '.repeat(indent) + '[]')
        } else {
          o.forEach((item) => {
            if (typeof item === 'object' && item !== null) {
              lines.push(' '.repeat(indent) + `-`)
              render(item, indent + 2)
            } else {
              lines.push(' '.repeat(indent) + `- ${JSON.stringify(item)}`)
            }
          })
        }
      } else {
        Object.entries(o as Record<string, unknown>).forEach(([k, v]) => {
          if (typeof v === 'object' && v !== null) {
            lines.push(' '.repeat(indent) + `${k}:`)
            render(v, indent + 2)
          } else {
            lines.push(' '.repeat(indent) + `${k}: ${JSON.stringify(v)}`)
          }
        })
      }
    } else {
      lines.push(' '.repeat(indent) + JSON.stringify(o))
    }
  }
  render(obj, 0)
  return lines.join('\n')
}

/**
 * 生成两行文本列表的差异行
 *
 * 逐行对比，标记每行的类型：unchanged / added / removed / modified。
 * 当两侧行数不一致时，缺失侧以空内容填充。
 *
 * @param lines - 当前侧的行文本数组
 * @param compareLines - 对比侧的行文本数组
 * @param side - 当前侧标识，影响 removed/added 的方向判断
 * @returns 差异行列表
 */
export const generateDiffLines = (
  lines: string[],
  compareLines: string[],
  side: 'original' | 'generated'
): DiffLine[] => {
  const result: DiffLine[] = []
  const maxLen = Math.max(lines.length, compareLines.length)

  for (let i = 0; i < maxLen; i++) {
    const line = lines[i]
    const cmpLine = compareLines[i]

    if (line === undefined) {
      result.push({ content: '', type: 'added', prefix: '+' })
    } else if (cmpLine === undefined) {
      result.push({
        content: line,
        type: side === 'original' ? 'removed' : 'added',
        prefix: side === 'original' ? '-' : '+',
      })
    } else if (line !== cmpLine) {
      result.push({ content: line, type: 'modified', prefix: '~' })
    } else {
      result.push({ content: line, type: 'unchanged', prefix: ' ' })
    }
  }
  return result
}

/**
 * 高亮显示文本中的变更内容
 *
 * 将 changes 中的 oldValue 和 newValue 分别包装为
 * `highlight-removed` 和 `highlight-added` 的 span 标签，
 * 用于在 diff 视图中直观展示修改点。
 *
 * @param content - 原始文本内容
 * @param changes - 变更项列表，每项包含旧值和新值
 * @returns 带高亮 HTML 的字符串
 */
export const highlightChanges = (
  content: string,
  changes?: { key: string; oldValue: unknown; newValue: unknown }[]
): string => {
  if (!content) return ''
  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  const escaped = escapeHtml(content)
  if (!changes || changes.length === 0) return escaped

  let result = escaped
  changes.forEach((change) => {
    const oldVal = escapeHtml(String(change.oldValue ?? ''))
    const newVal = escapeHtml(String(change.newValue ?? ''))
    if (oldVal && result.includes(oldVal)) {
      result = result.replace(oldVal, `<span class="highlight-removed">${oldVal}</span>`)
    }
    if (newVal && result.includes(newVal)) {
      result = result.replace(newVal, `<span class="highlight-added">${newVal}</span>`)
    }
  })
  return result
}

export function useConflictDiffEngine(selectedItem: ComputedRef<ConfigItemDiff<unknown> | null>) {
  const diffLines = computed<{ original: DiffLine[]; generated: DiffLine[] }>(() => {
    const item = selectedItem.value
    if (!item) return { original: [], generated: [] }

    const origFlat = flattenObject(item.original)
    const genFlat = flattenObject(item.generated)

    const origKeys = new Map<string, FlatKeyValue>()
    const genKeys = new Map<string, FlatKeyValue>()

    origFlat.forEach((f) => origKeys.set(f.path.join('.'), f))
    genFlat.forEach((f) => genKeys.set(f.path.join('.'), f))

    const allPaths = new Set([...origKeys.keys(), ...genKeys.keys()])
    const sortedPaths = Array.from(allPaths).sort((a, b) => a.localeCompare(b))

    const resultOriginal: DiffLine[] = []
    const resultGenerated: DiffLine[] = []

    for (const path of sortedPaths) {
      const orig = origKeys.get(path)
      const gen = genKeys.get(path)

      let status: 'unchanged' | 'added' | 'removed' | 'modified' = 'unchanged'

      if (orig && gen) {
        if (formatValue(orig.value) !== formatValue(gen.value)) {
          status = 'modified'
        }
      } else if (gen) {
        status = 'added'
      } else if (orig) {
        status = 'removed'
      }

      const buildLine = (
        kv: FlatKeyValue | undefined,
        sideStatus: 'unchanged' | 'added' | 'removed' | 'modified',
        isOrig: boolean
      ): DiffLine => {
        if (!kv) {
          return { content: '', type: 'unchanged', prefix: ' ', changes: [] }
        }

        const displayValue = formatValue(kv.value)
        const indent = kv.indent
        const prefix = kv.key.endsWith(']') ? kv.key : kv.key + ':'
        const content =
          displayValue === ''
            ? `${' '.repeat(indent)}${prefix}`
            : `${' '.repeat(indent)}${prefix} ${displayValue}`

        const finalStatus = isOrig
          ? sideStatus === 'added'
            ? 'removed'
            : sideStatus
          : sideStatus === 'removed'
            ? 'added'
            : sideStatus

        const finalPrefix = isOrig
          ? sideStatus === 'added'
            ? '-'
            : ' '
          : sideStatus === 'removed'
            ? '+'
            : ' '

        return {
          content,
          type: finalStatus,
          prefix: finalPrefix,
          changes: [],
          keyPath: kv.path.join('.'),
        }
      }

      resultOriginal.push(buildLine(orig, status, true))
      resultGenerated.push(buildLine(gen, status, false))
    }

    return {
      original: resultOriginal,
      generated: resultGenerated,
    }
  })

  return {
    diffLines,
  }
}

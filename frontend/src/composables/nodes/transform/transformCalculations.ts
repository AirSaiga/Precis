/**
 * @fileoverview Transform 纯计算函数集合
 *
 * 所有函数均为纯函数（或接近纯函数），无 Vue / graphStore 依赖。
 * 输入：上游行数据 + 转换参数
 * 输出：计算后的行数据 string[][]
 *
 * 每个导出函数对应一种 TransformType 的前端预览计算逻辑。
 */

import { ROW_CHANGING_TRANSFORMS, ROW_CHANGING_TYPE_LABELS } from './transformTypeRegistry'
interface OutputColumnsLike {
  outputColumns?: string[]
}

// ============================================================================
// 通用工具
// ============================================================================

/** 解析默认输出列名 */
export function resolveOutputColumns(
  transformData: OutputColumnsLike,
  fallback: string | string[]
): string[] {
  if (transformData.outputColumns && transformData.outputColumns.length > 0) {
    return transformData.outputColumns
  }
  return Array.isArray(fallback) ? fallback : [fallback]
}

// ============================================================================
// StringSplit：按分隔符拆分
// ============================================================================

export interface StringSplitOptions {
  delimiter: string
  maxsplit: number
}

export function computeStringSplit(
  upstreamRows: string[][],
  options: StringSplitOptions
): { columns: string[]; rowsByColumn: string[][][] } {
  const delimiter = options.delimiter || ','
  const maxsplit = options.maxsplit ?? -1

  const splitRows = upstreamRows.map((row) => {
    const value = String(row[0] || '')
    if (maxsplit === -1) return value.split(delimiter)
    return value.split(delimiter, maxsplit + 1)
  })

  // 取所有行中最大的分片数作为列数，避免只看第一行导致后续行的字段被静默丢弃
  const colCount = splitRows.length > 0 ? Math.max(...splitRows.map((r) => r.length), 1) : 1
  const rowsByColumn: string[][][] = Array.from({ length: colCount }, (_, i) =>
    splitRows.map((r) => [r[i] ?? ''])
  )

  return {
    columns: Array.from({ length: colCount }, (_, i) => `part${i + 1}`),
    rowsByColumn,
  }
}

// ============================================================================
// RegexExtract：正则提取捕获组
// ============================================================================

export interface RegexOptions {
  pattern: string
  flags: string
}

/**
 * 尝试用指定 pattern 提取捕获组内容
 * @returns 提取结果数组（三维），或 null（没有任何一行匹配成功）
 */
export function tryRegexExtract(
  pattern: string,
  flags: string,
  upstreamRows: string[][],
  outputColumns: string[]
): string[][][] | null {
  const extractedData: string[][][] = outputColumns.map(() => [])
  let hasMatch = false
  const validFlags = (flags || '')
    .split('')
    .filter((c) => 'gimsuy'.includes(c))
    .join('')

  for (const row of upstreamRows) {
    const value = String(row[0] ?? '')
    const regex = new RegExp(pattern, validFlags)
    const match = regex.exec(value)
    if (match && match.length > 1) {
      hasMatch = true
      for (let i = 0; i < outputColumns.length; i++) {
        const groupValue = match[i + 1] !== undefined ? String(match[i + 1]) : ''
        const target = extractedData[i]
        if (target) {
          target.push([groupValue])
        }
      }
    } else {
      for (let i = 0; i < outputColumns.length; i++) {
        const target = extractedData[i]
        if (target) {
          target.push([''])
        }
      }
    }
  }

  return hasMatch ? extractedData : null
}

/**
 * 修复常见的正则转义问题：
 * 1. 双反斜杠 \\d → \d
 * 2. 缺失反斜杠 d{n} → \d{n}、w → \w、s → \s 等
 */
export function normalizeRegexPattern(pattern: string): string {
  let normalized = pattern
  normalized = normalized.replace(/\\\\/g, '\\')
  normalized = normalized.replace(/(?<![\\])d(?={\d+})/g, '\\d')
  normalized = normalized.replace(/(?<![\\])w(?!\w)/g, '\\w')
  normalized = normalized.replace(/(?<![\\])s(?!\w)/g, '\\s')
  normalized = normalized.replace(/(?<![\\])D/g, '\\D')
  normalized = normalized.replace(/(?<![\\])W/g, '\\W')
  normalized = normalized.replace(/(?<![\\])S/g, '\\S')
  return normalized
}

export function computeRegexExtract(
  upstreamRows: string[][],
  options: RegexOptions,
  outputColumns: string[]
): string[][][] {
  const { pattern, flags } = options

  if (!pattern || upstreamRows.length === 0) {
    return outputColumns.map(() => upstreamRows)
  }

  // 第 1 层：使用原始 pattern
  let extractedData = tryRegexExtract(pattern, flags, upstreamRows, outputColumns)

  // 第 2 层：尝试修复常见转义问题后再匹配
  if (!extractedData) {
    const normalized = normalizeRegexPattern(pattern)
    if (normalized !== pattern) {
      extractedData = tryRegexExtract(normalized, flags, upstreamRows, outputColumns)
    }
  }

  if (extractedData) {
    return extractedData
  }

  // 所有尝试均失败，回退到原始数据
  return outputColumns.map(() => upstreamRows)
}

// ============================================================================
// Digits：逐字符拆分为多行
// ============================================================================

export function computeDigits(upstreamRows: string[][]): string[][] {
  const digitRows: string[][] = []
  for (const row of upstreamRows) {
    const value = String(row[0] ?? '')
    for (const ch of value) {
      digitRows.push([ch])
    }
  }
  return digitRows
}

// ============================================================================
// Substring：子串提取
// ============================================================================

export interface SubstringOptions {
  start: number
  end?: number
  length?: number
}

export function computeSubstring(upstreamRows: string[][], options: SubstringOptions): string[][] {
  const { start, end, length } = options
  return upstreamRows.map((row) => {
    const value = String(row[0] ?? '')
    let result: string
    if (length != null) {
      result = value.substring(start, start + length)
    } else if (end != null) {
      result = value.substring(start, end)
    } else {
      result = value.substring(start)
    }
    return [result]
  })
}

// ============================================================================
// WeightedSum：加权求和
// ============================================================================

export function computeWeightedSum(upstreamRows: string[][], weights: number[]): string[][] {
  return upstreamRows.map((row) => {
    const value = String(row[0] ?? '')
    const digits = value
      .split('')
      .filter((c) => c >= '0' && c <= '9')
      .map((c) => parseInt(c, 10))

    let sum = 0
    for (let i = 0; i < Math.min(digits.length, weights.length); i++) {
      const digit = digits[i]
      const weight = weights[i]
      if (digit !== undefined && weight !== undefined) {
        sum += digit * weight
      }
    }
    return [String(sum)]
  })
}

// ============================================================================
// Modulo：取模
// ============================================================================

export function computeModulo(upstreamRows: string[][], divisor: number): string[][] {
  return upstreamRows.map((row) => {
    const v = parseFloat(String(row[0] ?? '0'))
    const val = isNaN(v) ? 0 : v
    return [String(divisor === 0 ? val : val % divisor)]
  })
}

// ============================================================================
// MapValue：查表映射
// ============================================================================

export function computeMapValue(
  upstreamRows: string[][],
  mapping: Array<string | number>
): string[][] {
  return upstreamRows.map((row) => {
    const raw = String(row[0] ?? '')
    const idx = parseInt(raw, 10)
    const mapped = !isNaN(idx) && idx >= 0 && idx < mapping.length ? String(mapping[idx]) : raw
    return [mapped]
  })
}

// ============================================================================
// MathExpr：数学表达式计算
// ============================================================================

export interface MathExprOptions {
  expression: string
  outputType: string
}

/**
 * 将 MathExpr 输出类型映射为 DataType
 */
export function mapMathExprOutputType(outputType: string): string {
  switch (outputType) {
    case 'int':
      return 'Integer'
    case 'float':
      return 'Float'
    default:
      return 'String'
  }
}

function safeMathEval(expr: string): number {
  const sanitized = expr.replace(/\s+/g, ' ').trim()
  if (!/^[\d\s+\-*/().%]+$/.test(sanitized)) {
    throw new Error(`表达式包含不支持的字符: ${expr}`)
  }
  const fn = new Function(`return (${sanitized})`)
  const result = fn()
  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error(`表达式计算结果无效: ${expr}`)
  }
  return result
}

export function computeMathExpr(upstreamRows: string[][], options: MathExprOptions): string[][] {
  const { expression, outputType } = options
  if (!expression) return upstreamRows

  const columnRefs = new Set<string>()
  const refPattern = /@(\w+)/g
  let refMatch
  while ((refMatch = refPattern.exec(expression)) !== null) {
    columnRefs.add(refMatch[1])
  }

  const columnIndex = 0

  const resultRows: string[][] = []
  for (const row of upstreamRows) {
    let evalExpr = expression
    for (const colName of columnRefs) {
      const safeValue = String(row[columnIndex] ?? '')
      evalExpr = evalExpr.replace(new RegExp(`@${colName}`, 'g'), safeValue)
    }

    try {
      const result = safeMathEval(evalExpr)

      let finalResult: string
      if (outputType === 'int') {
        finalResult = String(Math.trunc(result || 0))
      } else if (outputType === 'float') {
        finalResult = String(result || 0)
      } else {
        finalResult = String(result)
      }

      resultRows.push([finalResult])
    } catch {
      resultRows.push([row[columnIndex] ?? ''])
    }
  }

  return resultRows
}

// ============================================================================
// Replace：字符串替换
// ============================================================================

export interface ReplaceOptions {
  old: string
  new: string
  count: number
}

export function computeReplace(upstreamRows: string[][], options: ReplaceOptions): string[][] {
  const { old: oldStr, new: newStr, count } = options
  return upstreamRows.map((row) => {
    const value = String(row[0] ?? '')
    let replaced: string
    if (count === -1) {
      replaced = value.split(oldStr).join(newStr)
    } else {
      let replaced_count = 0
      replaced = value
      while (replaced_count < count && replaced.includes(oldStr)) {
        replaced = replaced.replace(oldStr, newStr)
        replaced_count++
      }
    }
    return [replaced]
  })
}

// ============================================================================
// Strip：去除首尾空白或指定字符
// ============================================================================

export function computeStrip(upstreamRows: string[][], chars: string): string[][] {
  return upstreamRows.map((row) => {
    const value = String(row[0] ?? '')
    let stripped: string
    if (chars) {
      const charSet = new Set(chars)
      let start = 0
      let end = value.length - 1
      while (start <= end) {
        const c = value[start]
        if (c === undefined || !charSet.has(c)) break
        start++
      }
      while (end >= start) {
        const c = value[end]
        if (c === undefined || !charSet.has(c)) break
        end--
      }
      stripped = value.substring(start, end + 1)
    } else {
      stripped = value.trim()
    }
    return [stripped]
  })
}

// ============================================================================
// UpperCase / LowerCase
// ============================================================================

export function computeUpperCase(upstreamRows: string[][]): string[][] {
  return upstreamRows.map((row) => [String(row[0] ?? '').toUpperCase()])
}

export function computeLowerCase(upstreamRows: string[][]): string[][] {
  return upstreamRows.map((row) => [String(row[0] ?? '').toLowerCase()])
}

// ============================================================================
// DateFormat：日期格式化
// ============================================================================

export interface DateFormatOptions {
  inputFormat: string
  outputFormat: string
}

function formatDate(dateStr: string, _inFmt: string, outFmt: string): string {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')

    return outFmt
      .replace('%Y', String(year))
      .replace('%m', month)
      .replace('%d', day)
      .replace('%H', hours)
      .replace('%M', minutes)
      .replace('%S', seconds)
  } catch {
    return dateStr
  }
}

export function computeDateFormat(
  upstreamRows: string[][],
  options: DateFormatOptions
): string[][] {
  const inputFormat = options.inputFormat || '%Y-%m-%d'
  const outputFormat = options.outputFormat || '%Y/%m/%d'
  return upstreamRows.map((row) => [formatDate(String(row[0] ?? ''), inputFormat, outputFormat)])
}

// ============================================================================
// Lookup：查找映射
// ============================================================================

export function computeLookup(
  upstreamRows: string[][],
  mapping: Record<string, string>,
  defaultVal?: string
): string[][] {
  return upstreamRows.map((row) => {
    const value = String(row[0] ?? '')
    const mapped = mapping[value]
    const finalValue = mapped !== undefined ? mapped : defaultVal !== undefined ? defaultVal : value
    return [String(finalValue)]
  })
}

// ============================================================================
// CastType：类型转换
// ============================================================================

export function computeCastType(upstreamRows: string[][], targetType: string): string[][] {
  return upstreamRows.map((row) => {
    const value = String(row[0] ?? '')
    let casted: string

    try {
      switch (targetType) {
        case 'int':
          casted = String(Math.trunc(Number(value) || 0))
          break
        case 'float':
          casted = String(Number(value) || 0)
          break
        case 'bool':
          casted = value.toLowerCase() === 'true' || value === '1' ? 'true' : 'false'
          break
        case 'datetime': {
          const date = new Date(value)
          casted = isNaN(date.getTime()) ? value : date.toISOString()
          break
        }
        case 'string':
        default:
          casted = value
          break
      }
    } catch {
      casted = value
    }

    return [casted]
  })
}

/**
 * 将 CastType 目标类型映射为 DataType
 */
export function mapCastTypeOutputType(targetType: string): string {
  switch (targetType) {
    case 'int':
      return 'Integer'
    case 'float':
      return 'Float'
    case 'bool':
      return 'Boolean'
    case 'datetime':
      return 'Date'
    case 'string':
    default:
      return 'String'
  }
}

// ============================================================================
// Concat：列拼接
// ============================================================================

export interface ConcatOptions {
  columns: string
  separator: string
}

export function computeConcat(upstreamRows: string[][], options: ConcatOptions): string[][] {
  const { separator } = options
  const rawColumns = options.columns as string | string[]
  const columnList = Array.isArray(rawColumns)
    ? rawColumns.filter(Boolean)
    : String(rawColumns)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)

  return upstreamRows.map((row) => {
    if (columnList.length === 0) {
      return [String(row[0] ?? '')]
    }
    const value = String(row[0] ?? '')
    const concatResult = columnList.map(() => value).join(separator)
    return [concatResult]
  })
}

// ============================================================================
// ConditionalAssign：条件赋值
// ============================================================================

export interface Condition {
  column: string
  op: string
  value: string
}

export interface ConditionalAssignOptions {
  conditions: Condition[]
  logic: string
  then_value: string
  else_value?: string
}

function checkCondition(rowValue: string, op: string, condValue: string): boolean {
  switch (op) {
    case 'eq':
      return rowValue === condValue
    case 'ne':
      return rowValue !== condValue
    case 'gt':
      return Number(rowValue) > Number(condValue)
    case 'gte':
      return Number(rowValue) >= Number(condValue)
    case 'lt':
      return Number(rowValue) < Number(condValue)
    case 'lte':
      return Number(rowValue) <= Number(condValue)
    case 'contains':
      return rowValue.includes(condValue)
    case 'startsWith':
      return rowValue.startsWith(condValue)
    case 'endsWith':
      return rowValue.endsWith(condValue)
    case 'regex':
      try {
        return new RegExp(condValue).test(rowValue)
      } catch {
        return false
      }
    case 'in':
      return condValue
        .split(',')
        .map((v) => v.trim())
        .includes(rowValue)
    default:
      return false
  }
}

export function computeConditionalAssign(
  upstreamRows: string[][],
  options: ConditionalAssignOptions
): string[][] {
  const { conditions, logic, then_value, else_value } = options

  return upstreamRows.map((row) => {
    const rowValue = String(row[0] ?? '')
    const conditionResults = conditions.map((cond) => checkCondition(rowValue, cond.op, cond.value))

    let allConditionsMet: boolean
    if (logic === 'or') {
      allConditionsMet = conditionResults.some((r) => r)
    } else {
      allConditionsMet = conditionResults.every((r) => r)
    }

    const finalValue = allConditionsMet
      ? then_value
      : else_value !== undefined
        ? else_value
        : rowValue
    return [String(finalValue)]
  })
}

// ============================================================================
// Summary（行数改变型的汇总预览）
// ============================================================================

export function computeSummary(
  upstreamRows: string[][],
  transformType: string
): { columnName: string; rows: string[][] } {
  const colName = ROW_CHANGING_TYPE_LABELS[transformType] || '结果'
  const summaryRows = upstreamRows.map(() => [`${transformType} 预览: ${upstreamRows.length} 行`])
  return { columnName: colName, rows: summaryRows }
}

// ============================================================================
// computeTransformResult — 统一分发入口
// ============================================================================

/**
 * 按 transformType 分发计算，返回输出列名和行数据。
 *
 * 供 useTransformSave（创建输出节点）和 templateExpand handler（就地写入 rows）
 * 共用，消除 22 种 transformType 的重复分发逻辑。
 */
export function computeTransformResult(
  type: string,
  upstreamRows: string[][],
  params: Record<string, unknown>,
  meta: { inputColumn?: string; outputColumns?: string[] }
): { columns: string[]; rowsByColumn: string[][][]; outputDataType?: string } {
  const dataLike = {
    inputColumn: meta.inputColumn,
    outputColumns: meta.outputColumns,
  } as { inputColumn?: string; outputColumns?: string[] }

  if (type === 'StringSplit') {
    const result = computeStringSplit(upstreamRows, {
      delimiter: (params.delimiter as string) || ',',
      maxsplit: (params.maxsplit as number) ?? -1,
    })
    return {
      columns: resolveOutputColumns(dataLike, result.columns),
      rowsByColumn: result.rowsByColumn,
    }
  }

  if (type === 'RegexExtract') {
    const outputColumns =
      meta.outputColumns && meta.outputColumns.length > 0 ? meta.outputColumns : ['extract_1']
    return {
      columns: outputColumns,
      rowsByColumn: computeRegexExtract(
        upstreamRows,
        { pattern: (params.pattern as string) || '', flags: (params.flags as string) || '' },
        outputColumns
      ),
    }
  }

  if (type === 'Digits') {
    return {
      columns: resolveOutputColumns(dataLike, 'digits'),
      rowsByColumn: [computeDigits(upstreamRows)],
    }
  }

  if (type === 'Substring') {
    const rows = computeSubstring(upstreamRows, {
      start: (params.start as number) ?? 0,
      end: params.end as number | undefined,
      length: params.length as number | undefined,
    })
    return {
      columns: resolveOutputColumns(dataLike, `${meta.inputColumn || 'result'}_result`),
      rowsByColumn: [rows],
    }
  }

  if (type === 'WeightedSum') {
    return {
      columns: resolveOutputColumns(dataLike, 'weighted_sum'),
      rowsByColumn: [computeWeightedSum(upstreamRows, (params.weights as number[]) || [])],
    }
  }

  if (type === 'Modulo') {
    const divisor = parseFloat(String((params.divisor as number) ?? 1)) || 1
    return {
      columns: resolveOutputColumns(dataLike, 'modulo_result'),
      rowsByColumn: [computeModulo(upstreamRows, divisor)],
    }
  }

  if (type === 'MapValue') {
    return {
      columns: resolveOutputColumns(dataLike, 'mapped'),
      rowsByColumn: [
        computeMapValue(upstreamRows, (params.mapping as Array<string | number>) || []),
      ],
    }
  }

  if (ROW_CHANGING_TRANSFORMS.has(type)) {
    const summary = computeSummary(upstreamRows, type)
    return { columns: [summary.columnName], rowsByColumn: [summary.rows] }
  }

  const baseName = meta.inputColumn || 'result'
  const concatOutputColumn = (params.output_column as string) || ''
  const columns =
    type === 'Concat' && concatOutputColumn
      ? [concatOutputColumn]
      : resolveOutputColumns(dataLike, type === 'Concat' ? 'concat_result' : `${baseName}_result`)

  let rows: string[][]
  let outputDataType: string | undefined
  switch (type) {
    case 'MathExpr': {
      const outputType = (params.output_type as string) || ''
      rows = computeMathExpr(upstreamRows, {
        expression: (params.expression as string) || '',
        outputType,
      })
      if (outputType) outputDataType = mapMathExprOutputType(outputType)
      break
    }
    case 'Replace':
      rows = computeReplace(upstreamRows, {
        old: (params.old as string) || '',
        new: (params.new as string) || '',
        count: (params.count as number) ?? -1,
      })
      break
    case 'Strip':
      rows = computeStrip(upstreamRows, (params.chars as string) || '')
      break
    case 'UpperCase':
      rows = computeUpperCase(upstreamRows)
      break
    case 'LowerCase':
      rows = computeLowerCase(upstreamRows)
      break
    case 'DateFormat':
      rows = computeDateFormat(upstreamRows, {
        inputFormat: (params.input_format as string) || '%Y-%m-%d',
        outputFormat: (params.output_format as string) || '%Y/%m/%d',
      })
      outputDataType = 'Date'
      break
    case 'Lookup':
      rows = computeLookup(
        upstreamRows,
        (params.mapping as Record<string, string>) || {},
        (params.default as string) ?? undefined
      )
      break
    case 'CastType': {
      const targetType = (params.target_type as string) || 'string'
      rows = computeCastType(upstreamRows, targetType)
      outputDataType = mapCastTypeOutputType(targetType)
      break
    }
    case 'Concat':
      rows = computeConcat(upstreamRows, {
        columns: (params.columns as string) || '',
        separator: (params.separator as string) || '',
      })
      break
    case 'ConditionalAssign':
      rows = computeConditionalAssign(upstreamRows, {
        conditions:
          (params.conditions as Array<{ column: string; op: string; value: string }>) || [],
        logic: (params.logic as string) || 'and',
        then_value: (params.then_value as string) ?? '',
        else_value: (params.else_value as string) ?? undefined,
      })
      break
    default:
      rows = upstreamRows
      break
  }

  return { columns, rowsByColumn: [rows], outputDataType }
}

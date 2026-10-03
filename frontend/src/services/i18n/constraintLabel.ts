/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * @fileoverview 约束结构化描述（describe_data）→ 英文标签渲染：en-US 下把后端
 * describe_data() 的结构化配置（kind + 表/列/原始参数）渲染为可读英文标签。
 *
 * zh-CN 不经过本模块——沿用后端 description 原文（中文契约字段）。
 *
 * 与后端 CLI 侧 backend/app/cli/shell/constraint_summaries.py 同构对位
 * （消费同一份 describe_data，两侧口径需保持一致）；渲染失败返回 null，
 * 调用方回退 message 原文。
 */

/** describe_data 的宽松类型（kind + 各约束类型自有的配置字段） */
export type ConstraintDescribeData = Record<string, unknown>

const CHARSET_NAMES_EN: Record<string, string> = {
  ascii: 'ASCII',
  chinese: 'Chinese',
  chinese_mixed: 'Chinese (mixed)',
}

/** 允许值清单的展示截断（与后端 zh description 的"前 5 个"口径一致） */
const ALLOWED_PREVIEW_LIMIT = 5

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/** 单个标量的 Python repr 近似（str 加单引号，其余 String 化；与 CLI 侧 str()/repr 口径对位） */
function reprScalar(value: unknown): string {
  return typeof value === 'string' ? `'${value}'` : str(value)
}

/** 列表的 Python repr 近似：['a', 'b']（", " 分隔，元素 repr 化） */
function reprList(values: unknown[]): string {
  return `[${values.map(reprScalar).join(', ')}]`
}

function allowedValuesPreview(values: unknown): string {
  if (!Array.isArray(values)) return '[]'
  if (values.length <= ALLOWED_PREVIEW_LIMIT) return reprList(values)
  return `${reprList(values.slice(0, ALLOWED_PREVIEW_LIMIT))}...`
}

function rangeSuffix(d: ConstraintDescribeData): string | null {
  const lo = d.min
  const hi = d.max
  const inclusive = d.boundary_mode !== 'exclusive'
  if (lo !== null && lo !== undefined && hi !== null && hi !== undefined) {
    return inclusive ? `range [${str(lo)}, ${str(hi)}]` : `range (${str(lo)}, ${str(hi)})`
  }
  if (lo !== null && lo !== undefined) return inclusive ? `>= ${str(lo)}` : `> ${str(lo)}`
  if (hi !== null && hi !== undefined) return inclusive ? `<= ${str(hi)}` : `< ${str(hi)}`
  return null
}

function conditionalThenClause(then: unknown): string {
  // dict → "satisfy DSL {...}"（Python dict repr 近似：': ' 与 ', ' 分隔，与 CLI 侧对位）
  if (then !== null && typeof then === 'object') {
    const entries = Object.entries(then as Record<string, unknown>).map(
      ([k, v]) => `'${k}': ${reprScalar(v)}`
    )
    return `satisfy DSL {${entries.join(', ')}}`
  }
  if (typeof then === 'string') return `satisfy registered rule '${then}'`
  return 'satisfy an unknown rule'
}

function dateLogicSuffix(d: ConstraintDescribeData): string {
  if (d.logic_mode === 'compare') {
    const op = (d.compare_op as string) || 'gt'
    if (op === 'range') {
      const start = d.reference_column ?? d.reference_date
      const end = d.reference_column_end ?? d.reference_date_end
      return ` range [${str(start)}, ${str(end)}]`
    }
    const ref = d.reference_column ?? d.reference_date
    return ` ${op} ${str(ref)}`
  }
  if (d.logic_mode === 'calculation') return ` ${str(d.calculation_type)} check`
  return ''
}

/**
 * 把结构化约束描述渲染为英文标签。
 *
 * @param d 后端 describe_data（至少含 kind），可为 null/undefined
 * @returns 英文标签（如 "NotNull: orders.order_id"）；未知 kind / 关键字段缺失返回 null（调用方回退 message）
 */
export function renderConstraintLabelEn(
  d: ConstraintDescribeData | null | undefined
): string | null {
  if (!d || typeof d !== 'object') return null
  const kind = d.kind
  const table = d.table
  const tableName = str(table)
  const hasTable = table !== null && table !== undefined
  try {
    switch (kind) {
      case 'NotNull':
        return hasTable && 'column' in d ? `NotNull: ${tableName}.${str(d.column)}` : null
      case 'Unique': {
        const cols = Array.isArray(d.columns) ? d.columns.map(str).join(', ') : ''
        return hasTable && cols ? `Unique: ${tableName}.${cols}` : null
      }
      case 'AllowedValues':
        if (!hasTable || !('column' in d)) return null
        return `AllowedValues: ${tableName}.${str(d.column)} allowed ${allowedValuesPreview(d.allowed_values)}`
      case 'Range': {
        if (!hasTable || !('column' in d)) return null
        const suffix = rangeSuffix(d)
        const base = `Range: ${tableName}.${str(d.column)}`
        return suffix ? `${base} ${suffix}` : base
      }
      case 'ForeignKey':
        if (
          [d.from_table, d.from_column, d.to_table, d.to_column].some(
            (v) => v === null || v === undefined
          )
        )
          return null
        return `ForeignKey: ${str(d.from_table)}.${str(d.from_column)} -> ${str(d.to_table)}.${str(d.to_column)}`
      case 'Regex':
        if (!hasTable || !('column' in d)) return null
        return `Regex: ${tableName}.${str(d.column)} pattern='${str(d.pattern)}'`
      case 'Charset': {
        if (!hasTable || !('column' in d)) return null
        const mode = str(d.charset_mode)
        return `Charset: ${tableName}.${str(d.column)} (${CHARSET_NAMES_EN[mode] ?? 'unknown'})`
      }
      case 'Scripted':
        return hasTable ? `Scripted: ${tableName}.${str(d.name)}` : null
      case 'Conditional': {
        if (!hasTable) return null
        const thenClause = conditionalThenClause(d.then)
        const thenCol = str(d.then_column)
        if (Array.isArray(d.if_conditions) && d.if_conditions.length > 0) {
          return `Conditional: ${tableName} when the condition holds, ${thenCol} must ${thenClause}`
        }
        return `Conditional: ${tableName} when ${str(d.if_column)}=${str(d.if_value)}, ${thenCol} must ${thenClause}`
      }
      case 'DateLogic':
        if (!hasTable || !('column' in d)) return null
        return `DateLogic: ${tableName}.${str(d.column)}${dateLogicSuffix(d)}`
      case 'Composite':
        return `Composite (logic=${str(d.logic)}, ${str(d.sub_count)} sub-constraints)`
      default:
        return null
    }
  } catch {
    // 渲染安全网：任何拼接异常回退 null，展示端用 message 兜底
    return null
  }
}

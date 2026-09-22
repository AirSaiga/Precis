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
 * @file validationReportViewModel.ts
 * @description 校验报告视图模型
 *
 * 将后端返回的原始校验数据转换为前端展示用的视图模型（ViewModel）。
 * 负责错误分级、阶段归一化、位置描述生成等数据转换逻辑。
 *
 * 功能概述：
 * - createValidationReportViewModel: 主入口，将 FullValidationResponse 转为 ValidationReportViewModel
 * - normalizeValidationStage: 将后端阶段标识归一化为前端展示阶段
 * - getValidationStageLabelKey: 获取阶段对应的 i18n 键名
 * - formatValidationReportMessage: 格式化校验错误消息
 *
 * 架构设计：
 * - 纯函数设计，无副作用，便于单元测试
 * - 与 UI 组件解耦，可被报告导出服务复用
 * - 类型安全：所有转换都有明确的接口定义
 */

import type {
  FullValidationErrorItem,
  FullValidationResponse,
  ValidationPassedItem,
} from '@/api/projectValidationApi'
import type { TranslateFn } from '@/core/i18n/renderText'
import { renderText } from '@/core/i18n/renderText'
import type { RowLocalizedMessage } from '@/services/i18n/localizedMessage'
import { renderLocalizedMessage } from '@/services/i18n/localizedMessage'

export interface ValidationReportErrorRow extends FullValidationErrorItem {
  key: string
  type_label: string
  location: string
  normalized_stage: string
  display_message: string
  suggestion: string | null
  /**
   * key 化错误（i18n 治理）：error_code → validation.codes.<CODE>，行号走 validation.rowError 前缀。
   * 渲染端优先用它经 renderLocalizedMessage 按当前语言渲染；缺省回退 display_message 原文。
   */
  localizedIssue?: RowLocalizedMessage
}

export interface ValidationReportPassedRow extends ValidationPassedItem {
  key: string
  type_label: string
  location: string
  normalized_stage: string
}

export interface ValidationReportViewModel {
  errors: ValidationReportErrorRow[]
  passedItems: ValidationReportPassedRow[]
  allCount: number
  failedCount: number
  passedCount: number
}

export function getValidationStageLabelKey(stage: string): string {
  const normalized = normalizeValidationStage(stage)
  if (normalized === 'preflight') return 'common.fullValidation.task.stages.preflight'
  if (normalized === 'loading') return 'common.fullValidation.result.loading'
  if (normalized === 'format') return 'common.fullValidation.result.format'
  if (normalized === 'constraint') return 'common.fullValidation.result.constraint'
  if (normalized === 'regex') return 'common.fullValidation.result.regex'
  return 'common.fullValidation.table.stage'
}

export function normalizeValidationStage(stage?: string | null): string {
  return String(stage || 'constraint').toLowerCase()
}

const ID_PATTERN = /\b(sc_|c_|fk_|regex_)[A-Za-z0-9_-]{8,}\b/g
const MAX_ID_DISPLAY_LEN = 20

function truncateId(id: string): string {
  if (id.length <= MAX_ID_DISPLAY_LEN) return id
  const prefix = id.slice(0, 6)
  const suffix = id.slice(-4)
  return `${prefix}...${suffix}`
}

export function truncateLongIds(message: string): string {
  return message.replace(ID_PATTERN, (match) => truncateId(match))
}

/**
 * 错误类型码 → 用户可读标签。
 *
 * check_type/error_type 是机器码（DataLoad/RegexExecutionError/SchemaIdDuplicate 等），
 * 对用户是黑话；已知码经 validation.errorTypes.* 渲染为当前语言文案，
 * 未登记的码回退原文（renderText 按 key 存在性回退）。
 */
export function validationErrorTypeLabel(t: TranslateFn, code: string | null | undefined): string {
  if (!code) return ''
  return renderText(t, `validation.errorTypes.${code}`, code)
}

/**
 * 渲染单条报告错误的展示文案（i18n 治理）。
 *
 * 优先用 key 化的 localizedIssue（error_code → validation.codes.<CODE>，随 locale 切换），
 * 未登记错误码的旧数据回退 display_message 原文。
 */
export function localizedErrorText(t: TranslateFn, row: ValidationReportErrorRow): string {
  return row.localizedIssue ? renderLocalizedMessage(t, row.localizedIssue) : row.display_message
}

const SUGGESTION_SPLIT_RE = /(?:\s|^)[\s：:]*(?:建议|Suggestion)\s*[:：]\s*/i

function splitMessageAndSuggestion(message: string): { body: string; suggestion: string | null } {
  const parts = message.split(SUGGESTION_SPLIT_RE)
  if (parts.length >= 2 && parts[0] !== undefined) {
    const body = parts[0].trim()
    const suggestion = parts.slice(1).join('建议:').trim()
    return { body, suggestion }
  }
  return { body: message.trim(), suggestion: null }
}

export function formatValidationReportMessage(message: string, table?: string | null): string {
  if (!message) return '-'
  const tablePrefix = table ? `表 '${table}' ` : ''
  if (tablePrefix && message.includes(tablePrefix)) {
    return (
      message
        .replace(tablePrefix, '')
        .replace(/^[\s：:]+/, '')
        .replace(/[\s：:]+$/, '') || message
    )
  }
  return message
}

/**
 * 从全量校验错误项构建 key 化错误（i18n 治理）。
 *
 * error_code 存在时映射为 validation.codes.<CODE>（行级错误带 1-based row，
 * 渲染时组合 validation.rowError 行前缀）；无错误码返回 undefined，渲染端回退原文。
 */
function buildLocalizedIssue(item: FullValidationErrorItem): RowLocalizedMessage | undefined {
  if (!item.error_code) return undefined
  return {
    key: `validation.codes.${item.error_code}`,
    fallback: item.message,
    params: item.error_params ?? undefined,
    // row_index 为 0-based；展示统一 1-based（与 location 列的 rowLabel 口径一致）
    row: item.row_index === null || item.row_index === undefined ? undefined : item.row_index + 1,
  }
}

export function createValidationReportViewModel(
  data: FullValidationResponse | null,
  options: { rowLabel: string }
): ValidationReportViewModel {
  const source = data || {
    success: false,
    summary: {
      files_total: 0,
      files_loaded: 0,
      tables_loaded: 0,
      loading_error_count: 0,
      format_error_count: 0,
      constraint_error_count: 0,
      total_error_count: 0,
      duration_ms: 0,
    },
    errors: [],
  }

  const errors = (source.errors || []).map((item, index) => {
    const { body, suggestion } = splitMessageAndSuggestion(item.message)
    return {
      ...item,
      key: `error-${index}`,
      type_label: item.check_type || item.error_type,
      location: formatValidationErrorLocation(item, options.rowLabel),
      normalized_stage: normalizeValidationStage(item.stage),
      display_message: truncateLongIds(body),
      suggestion: suggestion ? truncateLongIds(suggestion) : null,
      localizedIssue: buildLocalizedIssue(item),
    }
  })

  const passedItems = (source.passed_items || []).map((item, index) => ({
    ...item,
    key: `passed-${index}`,
    type_label: item.check_type,
    location: formatValidationPassedLocation(item),
    normalized_stage: normalizeValidationStage(item.stage),
  }))

  return {
    errors,
    passedItems,
    allCount: errors.length + passedItems.length,
    failedCount: errors.length,
    passedCount: passedItems.length,
  }
}

function formatValidationErrorLocation(item: FullValidationErrorItem, rowLabel: string): string {
  const parts: string[] = []
  if (item.source_file) {
    const fileName = item.source_file.split(/[\\/]/).pop() || item.source_file
    let loc = fileName
    if (item.source_sheet) {
      loc += `-${item.source_sheet}`
    }
    parts.push(loc)
  } else if (item.table) {
    parts.push(item.table)
  }
  if (item.column) parts.push(item.column)
  if (item.row_index !== undefined && item.row_index !== null)
    parts.push(`${rowLabel} ${item.row_index + 1}`)
  return parts.join(' > ') || '-'
}

function formatValidationPassedLocation(item: ValidationPassedItem): string {
  const parts: string[] = []
  if (item.table) parts.push(item.table)
  if (item.column) parts.push(item.column)
  return parts.join(' > ') || '-'
}

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
 * @file localizedMessage.ts
 * @description 服务/校验层错误消息的 key 化结构
 *
 * 背景：服务层与校验器（constraints/validators、preValidator、columnValidation 等）
 * 运行在非组件上下文，无法直接调用 useI18n() 的 t()。历史上这些层把中文字符串
 * 直接写进 message 字段，导致错误消息无法随 locale 切换。
 *
 * 本模块定义贯穿"服务 → UI"的统一消息结构：
 *   - key：i18n key（如 'validation.notNull.valueEmpty'）
 *   - fallback：key 缺失时的兜底文案（通常是原始中文/英文，保证总有显示）
 *   - params：插值参数（如 { row: 3 }）
 *
 * UI 层渲染时用 @/core/i18n/renderText 的 renderText(t, key, fallback, params) 解析。
 * 这是既有的"先例 B1（code→message）+ 先例 B2（key+fallback+params）"的泛化统一形态。
 */

import type { TranslateFn } from '@/core/i18n/renderText'
import { renderText } from '@/core/i18n/renderText'

/**
 * key 化的可本地化消息。
 *
 * 约束：
 *   - key 必须是已在 zh-CN/en-US 语言包中定义的点路径，否则降级到 fallback。
 *   - fallback 不得为空，确保 key 缺失时仍有可见文本。
 */
export interface LocalizedMessage {
  /** i18n key，如 'validation.notNull.valueEmpty' */
  key: string
  /** key 缺失时的兜底文案（原始本地化字符串） */
  fallback: string
  /** 插值参数，如 { row: 3, column: 'name' }，可选 */
  params?: Record<string, unknown>
}

/**
 * 带可选行号前缀的本地化校验错误。
 *
 * row 提供时渲染为 "第 {row} 行: <正文>"（行前缀 key: validation.rowError），
 * 正文由 key/fallback/params 渲染——行前缀与正文分属两个 key，避免每个错误码
 * 重复维护行前缀文案。后端错误行的 row_index + error_code/error_params 可直接映射为本结构。
 */
export interface RowLocalizedMessage extends LocalizedMessage {
  /** 1-based 行号；省略表示非行级（配置类）错误，不渲染行前缀 */
  row?: number
}

/**
 * 构造一条 LocalizedMessage 的便捷工厂，集中校验 fallback 非空。
 * @param key       i18n key
 * @param fallback  key 缺失时的兜底文案（必填）
 * @param params    插值参数（可选）
 */
export function loc(
  key: string,
  fallback: string,
  params?: Record<string, unknown>
): LocalizedMessage {
  if (!fallback) {
    // fallback 是最后的显示保障，为空会导致 UI 空白；开发期尽早暴露
    throw new Error(`loc(): fallback 不能为空（key=${key}）`)
  }
  return { key, fallback, params }
}

/**
 * 渲染一条 RowLocalizedMessage 为展示字符串。
 *
 * - 有 row：`t('validation.rowError', { row, message: 正文 })`（zh: "第 {row} 行: {message}"）
 * - 无 row：仅渲染正文
 *
 * 正文经 renderText 解析（key 存在走 t(key, params)，缺失回退 fallback）。
 * 传响应式 t（useI18n）时结果随 locale 切换自动更新。
 */
export function renderLocalizedMessage(t: TranslateFn, message: RowLocalizedMessage): string {
  const body = renderText(t, message.key, message.fallback, message.params)
  if (message.row === undefined) return body
  return renderText(t, 'validation.rowError', `第 {row} 行: {message}`, {
    row: message.row,
    message: body,
  })
}

/**
 * 将后端校验错误行（error_code/error_params/error_message）映射为 RowLocalizedMessage。
 *
 * key 约定：`validation.codes.<ERROR_CODE>`——错误码由后端保证稳定，前端语言包按码提供
 * 双语文案；未登记的码自动回退 error_message 原文（renderText fallback 语义），前端零映射表。
 *
 * @param errorRow 后端错误行（含可选 error_code/error_params）
 * @param fallbackMessage error_message 缺失时的兜底文案（如 handler 定义的类型级提示）
 */
export function rowIssueFromBackendError(
  errorRow: {
    row_index?: number
    error_code?: string
    error_params?: Record<string, unknown>
    error_message?: string
  },
  fallbackMessage: string
): RowLocalizedMessage {
  const row = typeof errorRow.row_index === 'number' ? errorRow.row_index + 1 : undefined
  const message = errorRow.error_message || fallbackMessage
  if (errorRow.error_code) {
    return {
      key: `validation.codes.${errorRow.error_code}`,
      fallback: message,
      params: errorRow.error_params,
      row,
    }
  }
  // 无错误码（旧后端/未知来源）：key 置空，renderText 语义下直接显示 fallback 原文
  //（不能用占位 key——vue-i18n 对缺失 key 会原样返回 key 路径文本）
  return { key: '', fallback: message, row }
}

/**
 * 将 LocalizedMessage 渲染为最终展示字符串。
 *
 * 供无法拿到响应式 t 的调用方使用（导入全局 i18n 实例）。组件内应优先用
 * renderText(useI18n().t, ...)，仅在纯服务/工具上下文用本函数。
 */
export { renderText }

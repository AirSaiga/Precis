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
 * @fileoverview API 错误消息提取工具
 *
 * 统一从 Axios 错误中提取面向用户的错误文本：优先后端 detail（字符串或
 * Pydantic 422 数组），其次 error/message 字段。axios 默认的英文消息
 * （"Request failed with status code 404"）与请求头等技术细节不进用户消息，
 * 由调用方记入日志。
 */

export interface ApiErrorLike {
  response?: { data?: unknown; status?: number }
  message?: string
}

function isAxiosLike(e: unknown): e is ApiErrorLike {
  return typeof e === 'object' && e !== null && 'response' in e
}

/** 常见 HTTP 状态码的用户可读描述（无后端 detail 时的兜底） */
const STATUS_FALLBACK: Record<number, string> = {
  400: '请求参数有误',
  401: '请求未通过鉴权',
  403: '没有权限执行此操作',
  404: '请求的资源不存在',
  500: '服务器内部错误，请稍后重试',
  502: '服务暂时不可用，请稍后重试',
  503: '服务暂时不可用，请稍后重试',
}

/**
 * 从 Axios 风格错误响应体中提取后端 detail 文本。
 * detail 为字符串时原样返回；为 Pydantic 422 数组时取每项的 msg/message 拼接；
 * 均缺失时回退到 error / message 字段。
 */
export function extractApiErrorText(e: unknown): string | null {
  if (!isAxiosLike(e)) return null
  const data = e.response?.data as
    | { detail?: unknown; error?: unknown; message?: unknown }
    | undefined
  if (!data) return null

  const detail = data.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) =>
        String(
          (d as Record<string, unknown>).msg ??
            (d as Record<string, unknown>).message ??
            JSON.stringify(d)
        )
      )
      .filter((s) => s.trim())
    if (parts.length > 0) return parts.join('；')
  }
  if (typeof data.error === 'string' && data.error.trim()) return data.error
  if (typeof data.message === 'string' && data.message.trim()) return data.message
  return null
}

/**
 * 用户可见的 API 错误消息。
 *
 * 优先级：后端 detail > 状态码中文兜底 > 非 axios 错误自身的 message。
 * 技术细节（HTTP 头、状态码、原始英文异常）不由本函数拼入用户消息。
 */
export function getApiErrorMessage(e: unknown, fallback = '操作失败，请稍后重试'): string {
  if (isAxiosLike(e)) {
    const text = extractApiErrorText(e)
    if (text) return text
    const status = e.response?.status
    if (status && STATUS_FALLBACK[status]) return STATUS_FALLBACK[status]
    return fallback
  }
  return e instanceof Error && e.message ? e.message : fallback
}

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
 * @fileoverview 正则工具 API（后端 /utils/test-regex 封装）
 *
 * 产品正则方言是 Python re（后端执行引擎），保存校验与编辑提示都以
 * 后端编译结果为权威；前端 JS RegExp 只作两引擎语法一致部分的本地快检。
 */

import apiClient from '@/core/services/httpClient'

export interface RegexSyntaxValidationResult {
  valid: boolean
  /** 后端 Python re 编译失败的具体原因（valid 为 false 时存在） */
  error?: string
}

/**
 * 用后端 Python re 引擎校验正则语法（权威校验）。
 *
 * 复用 /utils/test-regex 端点：后端先 re.compile（编译失败即返回 error），
 * 再对 test_string 做 search——语法校验只关心编译结果，test_string 传空串即可。
 */
export async function validateRegexSyntax(pattern: string): Promise<RegexSyntaxValidationResult> {
  const res = await apiClient.post<{
    is_match: boolean
    groups: Record<string, string>
    error: string | null
  }>('/utils/test-regex', { regex: pattern, test_string: '' })
  return res.data.error ? { valid: false, error: res.data.error } : { valid: true }
}

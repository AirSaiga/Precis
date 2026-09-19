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
 * @fileoverview apiErrors 提取器测试（§2.1 结构化 detail 支持）
 */

import { describe, it, expect } from 'vitest'
import { extractApiErrorText, getApiErrorMessage } from '@/core/services/apiErrors'

function axiosLikeError(detail: unknown, status = 404) {
  return {
    isAxiosError: true,
    response: { status, data: { detail } },
  } as unknown as Record<string, unknown>
}

describe('extractApiErrorText - §2.1 结构化 detail', () => {
  it('dict detail（PROJECT_NOT_FOUND）取 message 展示', () => {
    const e = axiosLikeError({
      code: 'PROJECT_NOT_FOUND',
      message: '项目路径下未找到 project.precis.yaml（非合法 Precis 项目根）。',
      path: 'D:/x',
    })
    expect(extractApiErrorText(e)).toBe(
      '项目路径下未找到 project.precis.yaml（非合法 Precis 项目根）。'
    )
  })

  it('dict detail 无 message 时回退（不返回 [object Object]）', () => {
    const e = axiosLikeError({ code: 'X' })
    // 无 message → extractApiErrorText 返回 null，getApiErrorMessage 走状态码兜底
    expect(extractApiErrorText(e)).toBeNull()
    expect(typeof getApiErrorMessage(e)).toBe('string')
  })

  it('字符串 detail 保持原行为', () => {
    const e = axiosLikeError('普通错误消息')
    expect(extractApiErrorText(e)).toBe('普通错误消息')
  })

  it('数组 detail（pydantic 422）保持原行为', () => {
    const e = axiosLikeError([{ msg: 'field required' }], 422)
    expect(extractApiErrorText(e)).toBe('field required')
  })
})

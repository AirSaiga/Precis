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
 * @file renderText.test.ts
 * @description 共享 i18n 渲染助手 renderText 的单测（纯逻辑）
 *
 * 镜像源文件路径：src/core/i18n/renderText.ts
 */
import { describe, it, expect, vi } from 'vitest'
import { renderText, type TranslateFn } from '@/core/i18n/renderText'

describe('renderText', () => {
  it('key 存在时调用 t(key, params) 并返回其结果', () => {
    const t = vi.fn((k: string) => `[${k}]`) as TranslateFn
    const result = renderText(t, 'inspection.title', '兜底')
    expect(t).toHaveBeenCalledWith('inspection.title', {})
    expect(result).toBe('[inspection.title]')
  })

  it('带 params 时透传给 t', () => {
    const t = vi.fn((_k: string, p?: Record<string, unknown>) => `row=${p?.row}`) as TranslateFn
    const result = renderText(t, 'validation.rowError', '兜底', { row: 3 })
    expect(t).toHaveBeenCalledWith('validation.rowError', { row: 3 })
    expect(result).toBe('row=3')
  })

  it('key 为 undefined 时走 fallback，不调用 t', () => {
    const t = vi.fn() as TranslateFn
    const result = renderText(t, undefined, '原始中文')
    expect(t).not.toHaveBeenCalled()
    expect(result).toBe('原始中文')
  })

  it('key 为空串时走 fallback', () => {
    const t = vi.fn() as TranslateFn
    const result = renderText(t, '', '原始中文')
    expect(t).not.toHaveBeenCalled()
    expect(result).toBe('原始中文')
  })

  it('key 存在但 params 缺省时以空对象调用 t', () => {
    const t = vi.fn((k: string) => k) as TranslateFn
    renderText(t, 'some.key', '兜底')
    expect(t).toHaveBeenCalledWith('some.key', {})
  })
})

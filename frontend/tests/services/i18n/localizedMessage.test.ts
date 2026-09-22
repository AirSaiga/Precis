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
 * @file localizedMessage.test.ts
 * @description LocalizedMessage 结构与 loc 工厂的纯逻辑单测
 *
 * 镜像源文件路径：src/services/i18n/localizedMessage.ts
 */
import { describe, it, expect } from 'vitest'
import {
  loc,
  renderLocalizedMessage,
  rowIssueFromBackendError,
  type LocalizedMessage,
} from '@/services/i18n/localizedMessage'
import type { TranslateFn } from '@/core/i18n/renderText'

/** 模拟 vue-i18n 的 t：字典命中走插值，未命中原样返回 key（与 vue-i18n 缺失 key 行为一致） */
function makeT(dict: Record<string, string>): TranslateFn {
  return ((key: string, params?: Record<string, unknown>) => {
    const tpl = dict[key]
    if (tpl === undefined) return key
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`))
  }) as TranslateFn
}

describe('loc()', () => {
  it('构造基础 LocalizedMessage（key + fallback）', () => {
    const msg = loc('validation.notNull.valueEmpty', '值不能为空')
    expect(msg).toEqual({ key: 'validation.notNull.valueEmpty', fallback: '值不能为空' })
  })

  it('带 params 时透传', () => {
    const msg = loc('validation.rowError', '第 N 行错误', { row: 3 })
    expect(msg.params).toEqual({ row: 3 })
  })

  it('fallback 为空时抛错（保证 UI 不空白）', () => {
    expect(() => loc('some.key', '')).toThrow('fallback 不能为空')
  })

  it('返回值满足 LocalizedMessage 类型', () => {
    const msg: LocalizedMessage = loc('a.b', 'c')
    expect(msg.key).toBe('a.b')
    expect(msg.fallback).toBe('c')
  })
})

describe('renderLocalizedMessage()', () => {
  const t = makeT({
    'validation.rowError': 'Row {row}: {message}',
    'validation.codes.RANGE_COLUMN_NOT_NUMERIC': "Column '{column}' is not numeric",
  })

  it('无 row：只渲染正文（key 命中）', () => {
    const out = renderLocalizedMessage(t, {
      key: 'validation.codes.RANGE_COLUMN_NOT_NUMERIC',
      fallback: '兜底',
      params: { column: 'Total' },
    })
    expect(out).toBe("Column 'Total' is not numeric")
  })

  it('有 row：组合行前缀 key（validation.rowError）', () => {
    const out = renderLocalizedMessage(t, {
      key: 'validation.codes.RANGE_COLUMN_NOT_NUMERIC',
      fallback: '兜底',
      params: { column: 'Total' },
      row: 1,
    })
    expect(out).toBe("Row 1: Column 'Total' is not numeric")
  })

  it('key 为空：正文回退 fallback（无错误码的后端原文）', () => {
    const out = renderLocalizedMessage(t, { key: '', fallback: '原始中文', row: 3 })
    expect(out).toBe('Row 3: 原始中文')
  })

  it('key 未登记（缺失）：vue-i18n 行为为返回 key 路径，不吞错误', () => {
    const out = renderLocalizedMessage(t, {
      key: 'validation.codes.NOT_REGISTERED',
      fallback: '兜底',
    })
    expect(out).toBe('validation.codes.NOT_REGISTERED')
  })
})

describe('rowIssueFromBackendError()', () => {
  it('携带 error_code：映射 validation.codes.<CODE>，行号 0-based → 1-based', () => {
    const issue = rowIssueFromBackendError(
      {
        row_index: 0,
        error_code: 'RANGE_COLUMN_NOT_NUMERIC',
        error_params: { column: 'Total' },
        error_message: '区间约束失败: 数据格式不合规',
      },
      '类型级兜底'
    )
    expect(issue.key).toBe('validation.codes.RANGE_COLUMN_NOT_NUMERIC')
    expect(issue.params).toEqual({ column: 'Total' })
    expect(issue.row).toBe(1)
    expect(issue.fallback).toBe('区间约束失败: 数据格式不合规')
  })

  it('无 error_code：key 置空走 fallback（不产生伪造 key）', () => {
    const issue = rowIssueFromBackendError(
      { row_index: 4, error_message: '旧后端中文消息' },
      '类型级兜底'
    )
    expect(issue.key).toBe('')
    expect(issue.fallback).toBe('旧后端中文消息')
    expect(issue.row).toBe(5)
  })

  it('error_message 缺失：用类型级兜底文案', () => {
    const issue = rowIssueFromBackendError({ error_code: 'NOT_NULL_VALUE_EMPTY' }, '值不能为空')
    expect(issue.fallback).toBe('值不能为空')
    expect(issue.row).toBeUndefined()
  })
})

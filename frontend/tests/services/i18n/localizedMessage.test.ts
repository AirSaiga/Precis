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
import { loc, type LocalizedMessage } from '@/services/i18n/localizedMessage'

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

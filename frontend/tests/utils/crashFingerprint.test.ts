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
import { describe, it, expect } from 'vitest'
import { computeFingerprint } from '@/utils/crashFingerprint'

describe('computeFingerprint', () => {
  it('相同 message + stack 生成相同指纹', () => {
    const msg = 'TypeError: x is undefined'
    const stack = 'at a (f.js:1)\nat b (f.js:2)'
    expect(computeFingerprint(msg, stack)).toBe(computeFingerprint(msg, stack))
  })

  it('不同 message 生成不同指纹', () => {
    expect(computeFingerprint('error A', 's')).not.toBe(computeFingerprint('error B', 's'))
  })

  it('不同 stack 生成不同指纹', () => {
    expect(computeFingerprint('msg', 'stack A')).not.toBe(computeFingerprint('msg', 'stack B'))
  })

  it('stack 第 11 行之后的差异不影响指纹(只取前 10 行)', () => {
    const head = Array(10).fill('at x (f.js)').join('\n')
    const a = computeFingerprint('msg', head + '\nline-11-A')
    const b = computeFingerprint('msg', head + '\nline-11-B')
    expect(a).toBe(b)
  })

  it('空 stack 不抛错', () => {
    expect(typeof computeFingerprint('msg', undefined)).toBe('string')
    expect(typeof computeFingerprint('msg', '')).toBe('string')
  })

  it('返回十六进制字符串', () => {
    expect(computeFingerprint('msg', 's')).toMatch(/^[0-9a-f]+$/)
  })
})

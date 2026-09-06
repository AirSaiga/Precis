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
import { isRegexNodeType, REGEX_NODE_TYPES } from '@/utils/nodes/regex'

describe('isRegexNodeType', () => {
  it('matches regex and regexExtract', () => {
    expect(isRegexNodeType('regex')).toBe(true)
    expect(isRegexNodeType('regexExtract')).toBe(true)
  })

  it('does not match other types', () => {
    expect(isRegexNodeType('schema')).toBe(false)
    expect(isRegexNodeType('notNullConstraint')).toBe(false)
    expect(isRegexNodeType('')).toBe(false)
    expect(isRegexNodeType(undefined)).toBe(false)
  })

  it('REGEX_NODE_TYPES contains exactly two types', () => {
    expect(Array.from(REGEX_NODE_TYPES).sort()).toEqual(['regex', 'regexExtract'])
  })
})

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
 * @file ai 约束类型契约测试
 * @description 校验 codegen 生成物（后端 registry 单一事实源）与前端三套消费方对齐：
 * - services/constraints/constraintMeta.ts 的 CONSTRAINT_TYPES（nodeType/kind/v2Type 三向映射）
 * - i18n 双侧（zh-CN/en-US）constraintTypes 命名空间（camelCase kind 键）
 *
 * 新增约束类型时，任一侧漏同步都会在本文件红掉——这是 AI 链路
 * （提示词 → 写盘 → frontend_instruction → handler）防漂移的契约守卫。
 */
import { describe, it, expect } from 'vitest'
import {
  CANONICAL_CONSTRAINT_TYPES,
  CONSTRAINT_TYPE_ALIASES,
  CONSTRAINT_TYPE_MAP,
} from '@/types/generated/actions'
import { CONSTRAINT_TYPES } from '@/services/constraints/constraintMeta'
import { constraintTypes as zhConstraintTypes } from '@/i18n/locales/zh-CN/constraints'
import { constraintTypes as enConstraintTypes } from '@/i18n/locales/en-US/constraints'

describe('AI 约束类型契约（generated actions × constraintMeta × i18n）', () => {
  it('CANONICAL_CONSTRAINT_TYPES 非空、唯一且排序稳定（codegen 输出 sorted）', () => {
    expect(CANONICAL_CONSTRAINT_TYPES.length).toBeGreaterThan(0)
    expect(new Set(CANONICAL_CONSTRAINT_TYPES).size).toBe(CANONICAL_CONSTRAINT_TYPES.length)
    expect([...CANONICAL_CONSTRAINT_TYPES].sort()).toEqual([...CANONICAL_CONSTRAINT_TYPES])
  })

  it('CONSTRAINT_TYPE_MAP 覆盖全部标准名，且 value 为首字母小写的正名（ConstraintKind）', () => {
    for (const canonical of CANONICAL_CONSTRAINT_TYPES) {
      expect(CONSTRAINT_TYPE_MAP[canonical], `缺标准名键 ${canonical}`).toBeDefined()
      const decapitalized = canonical.charAt(0).toLowerCase() + canonical.slice(1)
      expect(CONSTRAINT_TYPE_MAP[canonical]).toBe(decapitalized)
    }
  })

  it('CONSTRAINT_TYPE_MAP 键集 = 标准名 ∪ 已声明别名（双向闭包，防手加野键/漏键）', () => {
    const canonicalSet = new Set(CANONICAL_CONSTRAINT_TYPES)
    const aliasKeys = Object.keys(CONSTRAINT_TYPE_ALIASES)
    for (const key of Object.keys(CONSTRAINT_TYPE_MAP)) {
      expect(
        canonicalSet.has(key) || aliasKeys.includes(key),
        `map 键 ${key} 既不是标准名也不是已声明别名`
      ).toBe(true)
    }
    // 每个已声明别名都必须出现在 map 中，且归一到与正名相同的 kind
    for (const [alias, canonical] of Object.entries(CONSTRAINT_TYPE_ALIASES)) {
      expect(canonicalSet.has(canonical), `别名 ${alias} 指向未知正名 ${canonical}`).toBe(true)
      expect(CONSTRAINT_TYPE_MAP[alias], `map 缺别名键 ${alias}`).toBe(
        CONSTRAINT_TYPE_MAP[canonical]
      )
    }
    // 历史别名 REGEX → Scripted
    expect(CONSTRAINT_TYPE_ALIASES.REGEX).toBe('Scripted')
  })

  it('map 的 kind 与 constraintMeta 注册表一一对应（nodeType/kind/v2Type 三向一致）', () => {
    for (const canonical of CANONICAL_CONSTRAINT_TYPES) {
      const kind = CONSTRAINT_TYPE_MAP[canonical]
      const meta = CONSTRAINT_TYPES.find((m) => m.v2Type === canonical)
      expect(meta, `constraintMeta 缺 v2Type=${canonical}`).toBeDefined()
      expect(meta?.kind).toBe(kind)
      expect(meta?.nodeType).toBe(`${kind}Constraint`)
    }
    // 反向：前端注册表不得多出后端不知道的约束类型（双出口漂移检测）
    for (const m of CONSTRAINT_TYPES) {
      expect(
        CANONICAL_CONSTRAINT_TYPES,
        `constraintMeta 的 v2Type=${m.v2Type} 不在后端注册表`
      ).toContain(m.v2Type)
    }
  })

  it('i18n 双侧（zh-CN/en-US）constraintTypes 覆盖全部 kind', () => {
    const kinds = new Set(Object.values(CONSTRAINT_TYPE_MAP))
    for (const kind of kinds) {
      expect(zhConstraintTypes, `zh-CN 缺 constraintTypes.${kind}`).toHaveProperty(kind)
      expect(enConstraintTypes, `en-US 缺 constraintTypes.${kind}`).toHaveProperty(kind)
      expect(
        (zhConstraintTypes as Record<string, { name?: string }>)[kind]?.name,
        `zh-CN constraintTypes.${kind} 缺 name`
      ).toBeTruthy()
      expect(
        (enConstraintTypes as Record<string, { name?: string }>)[kind]?.name,
        `en-US constraintTypes.${kind} 缺 name`
      ).toBeTruthy()
    }
  })
})

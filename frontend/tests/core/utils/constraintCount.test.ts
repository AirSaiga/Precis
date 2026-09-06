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
import {
  calculateConstraintStats,
  calculateConstraintStatsFromManifest,
} from '@/utils/constraintCount'
import type { TableSchemaFileV2 } from '@/types/projectV2'

describe('calculateConstraintStats', () => {
  it('returns zeros for empty inputs', () => {
    expect(calculateConstraintStats({}, {})).toEqual({ standalone: 0, inline: 0, total: 0 })
    expect(calculateConstraintStats(undefined, undefined)).toEqual({
      standalone: 0,
      inline: 0,
      total: 0,
    })
  })

  it('counts standalone constraints only', () => {
    const constraints = { c1: {}, c2: {} }
    expect(calculateConstraintStats({}, constraints)).toEqual({
      standalone: 2,
      inline: 0,
      total: 2,
    })
  })

  it('counts inline constraints from schemas', () => {
    const schemas: Record<string, TableSchemaFileV2> = {
      s1: { constraints: [{ id: 'ic1' }, { id: 'ic2' }] } as TableSchemaFileV2,
      s2: { constraints: [{ id: 'ic3' }] } as TableSchemaFileV2,
    }
    expect(calculateConstraintStats(schemas, {})).toEqual({ standalone: 0, inline: 3, total: 3 })
  })

  it('counts both standalone and inline constraints', () => {
    const schemas: Record<string, TableSchemaFileV2> = {
      s1: { constraints: [{ id: 'ic1' }] } as TableSchemaFileV2,
      s2: { constraints: [{ id: 'ic2' }, { id: 'ic3' }] } as TableSchemaFileV2,
    }
    const constraints = { c1: {}, c2: {} }
    expect(calculateConstraintStats(schemas, constraints)).toEqual({
      standalone: 2,
      inline: 3,
      total: 5,
    })
  })

  it('ignores schemas without constraints array', () => {
    const schemas: Record<string, TableSchemaFileV2> = {
      s1: { constraints: [{ id: 'ic1' }] } as TableSchemaFileV2,
      s2: {} as TableSchemaFileV2,
    }
    expect(calculateConstraintStats(schemas, undefined)).toEqual({
      standalone: 0,
      inline: 1,
      total: 1,
    })
  })
})

describe('calculateConstraintStatsFromManifest', () => {
  it('returns zeros for empty manifest and schemas', () => {
    expect(calculateConstraintStatsFromManifest({}, {})).toEqual({
      standalone: 0,
      inline: 0,
      total: 0,
    })
  })

  it('counts manifest constraints as standalone', () => {
    const manifest = { constraints: [{ id: 'c1' }, { id: 'c2' }] }
    expect(calculateConstraintStatsFromManifest(manifest, {})).toEqual({
      standalone: 2,
      inline: 0,
      total: 2,
    })
  })

  it('counts both manifest and inline constraints', () => {
    const manifest = { constraints: [{ id: 'c1' }] }
    const schemas: Record<string, TableSchemaFileV2> = {
      s1: { constraints: [{ id: 'ic1' }, { id: 'ic2' }] } as TableSchemaFileV2,
    }
    expect(calculateConstraintStatsFromManifest(manifest, schemas)).toEqual({
      standalone: 1,
      inline: 2,
      total: 3,
    })
  })
})

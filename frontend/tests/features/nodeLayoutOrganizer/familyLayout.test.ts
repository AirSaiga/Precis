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
  getFallbackDimension,
  groupByType,
  estimateColumnRowOffset,
  planConstraintSections,
  flowLayout,
  calculateBoundsFromLocal,
  calculateBoundsFromPositions,
  layoutFamily,
} from '@/features/node-layout-organizer/strategies/familyLayout'
import type { MemberColumnTarget } from '@/features/node-layout-organizer/types'
import type { NodeDimension } from '@/features/node-layout-organizer/utils/nodeDimensionHelper'
import { NODE_DIMENSIONS } from '@/features/node-layout-organizer/constants'

/** 构造成员目标列信息（列亲和测试工厂） */
function makeTarget(columnId: string, columnName: string, columnIndex: number): MemberColumnTarget {
  return { columnId, columnName, columnIndex }
}

describe('getFallbackDimension', () => {
  it('returns schema-specific dimensions for schema', () => {
    const dim = getFallbackDimension('schema')
    // 与 useSchemaResizable 的 DEFAULT_WIDTH(360) 对齐（DEF-14 校准，原 320）
    expect(dim.width).toBe(360)
    expect(dim.height).toBe(400)
  })

  it('returns default dimensions for regex', () => {
    const dim = getFallbackDimension('regex')
    expect(dim.width).toBe(NODE_DIMENSIONS.DEFAULT_WIDTH)
    expect(dim.height).toBe(NODE_DIMENSIONS.DEFAULT_HEIGHT)
  })

  it('returns constraint dimensions for constraint types', () => {
    const dim = getFallbackDimension('notNullConstraint')
    expect(dim.width).toBe(NODE_DIMENSIONS.CONSTRAINT_WIDTH)
    expect(dim.height).toBe(NODE_DIMENSIONS.CONSTRAINT_HEIGHT)
  })

  it('falls back to default dimension helper for unknown types', () => {
    const dim = getFallbackDimension('unknownType')
    expect(dim.width).toBeGreaterThan(0)
    expect(dim.height).toBeGreaterThan(0)
  })
})

describe('groupByType', () => {
  it('groups node IDs by their type', () => {
    const nodeTypeById = new Map([
      ['n1', 'schema'],
      ['n2', 'notNullConstraint'],
      ['n3', 'notNullConstraint'],
      ['n4', 'uniqueConstraint'],
    ])
    const result = groupByType(['n1', 'n2', 'n3', 'n4'], nodeTypeById)
    expect(result.get('schema')).toEqual(['n1'])
    expect(result.get('notNullConstraint')).toEqual(['n2', 'n3'])
    expect(result.get('uniqueConstraint')).toEqual(['n4'])
  })

  it('preserves input order within each type group', () => {
    // 分组不得重排：上游负责语义排序（如 Schema 列序），此处保序是布局语义的前提
    const nodeTypeById = new Map<string, string>([
      ['c', 'notNull'],
      ['a', 'notNull'],
      ['b', 'notNull'],
    ])
    const result = groupByType(['c', 'a', 'b'], nodeTypeById)
    expect(result.get('notNull')).toEqual(['c', 'a', 'b'])
  })

  it('uses "unknown" for nodes with no type entry', () => {
    const result = groupByType(['orphan'], new Map())
    expect(result.get('unknown')).toEqual(['orphan'])
  })

  it('returns empty map for empty input', () => {
    const result = groupByType([], new Map())
    expect(result.size).toBe(0)
  })
})

describe('estimateColumnRowOffset', () => {
  it('is monotone in column index and bounded by schema height', () => {
    const offsets = [0, 1, 2, 3].map((i) => estimateColumnRowOffset(i, 400, 4))
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]!)
    }
    expect(offsets[3]!).toBeLessThanOrEqual(400)
  })

  it('keeps row height positive for single-column schemas', () => {
    expect(estimateColumnRowOffset(0, 300, 1)).toBeGreaterThan(0)
  })
})

describe('planConstraintSections', () => {
  const nodeTypeById = new Map<string, string>([
    ['cn-nn', 'notNullConstraint'],
    ['cn-rg', 'rangeConstraint'],
    ['cn-uk', 'uniqueConstraint'],
    ['cn-fk', 'foreignKeyConstraint'],
  ])
  const schemaDim = { width: 360, height: 400 }

  it('column 模式：同列多类型约束合并为同一列节（标题=列名）', () => {
    const plans = planConstraintSections({
      constraints: ['cn-nn', 'cn-rg', 'cn-uk'],
      nodeTypeById,
      grouping: 'column',
      columnTargetById: new Map([
        ['cn-nn', makeTarget('col-a', 'name', 0)],
        ['cn-rg', makeTarget('col-a', 'name', 0)],
        ['cn-uk', makeTarget('col-b', 'age', 1)],
      ]),
      schemaDim,
      schemaColumnCount: 2,
    })
    expect(plans).toHaveLength(2)
    expect(plans[0]!.label).toBe('name')
    expect(plans[0]!.nodeIds).toEqual(['cn-nn', 'cn-rg'])
    expect(plans[1]!.label).toBe('age')
    expect(plans[1]!.nodeIds).toEqual(['cn-uk'])
  })

  it('column 模式：节序=列序，节内按类型标识次级稳定排序', () => {
    const plans = planConstraintSections({
      constraints: ['cn-uk', 'cn-nn', 'cn-rg'],
      nodeTypeById,
      grouping: 'column',
      columnTargetById: new Map([
        ['cn-uk', makeTarget('col-c', 'status', 2)],
        ['cn-nn', makeTarget('col-a', 'name', 0)],
        ['cn-rg', makeTarget('col-a', 'name', 0)],
      ]),
      schemaDim,
      schemaColumnCount: 3,
    })
    expect(plans.map((p) => p.label)).toEqual(['name', 'status'])
    // 同列节内按类型标识排序：notNullConstraint < rangeConstraint（ASCII 确定序）
    expect(plans[0]!.nodeIds).toEqual(['cn-nn', 'cn-rg'])
  })

  it('column 模式：无列引用与 columnId 失效的约束沉底为单一表级节', () => {
    const plans = planConstraintSections({
      constraints: ['cn-nn', 'cn-fk', 'cn-uk'],
      nodeTypeById,
      grouping: 'column',
      // cn-fk 无目标（表级）；cn-uk 有 sourceRef 但解析失败（列已删）→ 同样不入表
      columnTargetById: new Map([['cn-nn', makeTarget('col-a', 'name', 0)]]),
      schemaDim,
      schemaColumnCount: 2,
    })
    expect(plans).toHaveLength(2)
    const tablePlan = plans[1]!
    expect(tablePlan.key).toBe('tableLevel')
    expect(tablePlan.label).toBe('表级约束')
    expect(tablePlan.nodeIds).toEqual(['cn-fk', 'cn-uk'])
    expect(tablePlan.order).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('column 模式：列节带行对齐偏移，表级节无', () => {
    const plans = planConstraintSections({
      constraints: ['cn-nn', 'cn-fk'],
      nodeTypeById,
      grouping: 'column',
      columnTargetById: new Map([['cn-nn', makeTarget('col-a', 'name', 1)]]),
      schemaDim,
      schemaColumnCount: 4,
    })
    expect(plans[0]!.alignOffsetY).toBeGreaterThan(0)
    expect(plans[1]!.alignOffsetY).toBeUndefined()
  })

  it('column 模式：无 Schema 列信息（伪家族/无 columns）回退类型分节', () => {
    const plans = planConstraintSections({
      constraints: ['cn-nn', 'cn-rg'],
      nodeTypeById,
      grouping: 'column',
      schemaDim: null,
    })
    expect(plans.map((p) => p.key)).toEqual(['notNullConstraint', 'rangeConstraint'])
    expect(plans[0]!.label).toBe('非空约束')
  })

  it('type 模式：保持按类型分节的历史行为（标题=类型名、order=成员最小列序）', () => {
    const plans = planConstraintSections({
      constraints: ['cn-nn', 'cn-rg'],
      nodeTypeById,
      grouping: 'type',
      columnTargetById: new Map([
        ['cn-nn', makeTarget('col-a', 'name', 0)],
        ['cn-rg', makeTarget('col-b', 'age', 1)],
      ]),
      schemaDim,
      schemaColumnCount: 2,
    })
    expect(plans.map((p) => p.key)).toEqual(['notNullConstraint', 'rangeConstraint'])
    expect(plans[0]!.order).toBe(0)
    expect(plans[1]!.order).toBe(1)
    expect(plans.every((p) => p.alignOffsetY === undefined)).toBe(true)
  })
})

describe('flowLayout', () => {
  const defaultDim: NodeDimension = { width: 100, height: 50 }

  it('lays out single node at startX/startY', () => {
    const dims = new Map([['a', defaultDim]])
    const positions = new Map<string, { x: number; y: number }>()
    const { bounds, nextY } = flowLayout(['a'], positions, dims, 10, 20, 1000, 10)
    expect(positions.get('a')).toEqual({ x: 10, y: 20 })
    expect(bounds.x).toBe(10)
    expect(bounds.y).toBe(20)
    expect(nextY).toBe(70)
  })

  it('places nodes horizontally until row width is exceeded', () => {
    const dims = new Map<string, NodeDimension>([
      ['a', { width: 100, height: 50 }],
      ['b', { width: 100, height: 50 }],
      ['c', { width: 100, height: 50 }],
    ])
    const positions = new Map<string, { x: number; y: number }>()
    flowLayout(['a', 'b', 'c'], positions, dims, 0, 0, 220, 10)
    expect(positions.get('a')).toEqual({ x: 0, y: 0 })
    expect(positions.get('b')).toEqual({ x: 110, y: 0 })
    expect(positions.get('c')).toEqual({ x: 0, y: 60 })
  })

  it('uses fallback dimension when node dim is missing', () => {
    const positions = new Map<string, { x: number; y: number }>()
    flowLayout(['unknown'], positions, new Map(), 0, 0, 1000, 10)
    expect(positions.get('unknown')).toBeDefined()
  })
})

describe('calculateBoundsFromLocal', () => {
  const defaultDim: NodeDimension = { width: 100, height: 50 }

  it('returns null for empty input', () => {
    expect(calculateBoundsFromLocal([], new Map(), new Map())).toBeNull()
  })

  it('returns null when no positions are found', () => {
    const dims = new Map([['missing', defaultDim]])
    const result = calculateBoundsFromLocal(['missing'], new Map(), dims)
    expect(result).toBeNull()
  })

  it('computes bounding box from positions and dimensions', () => {
    const positions = new Map<string, { x: number; y: number }>([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 200, y: 100 }],
    ])
    const dims = new Map<string, NodeDimension>([
      ['a', defaultDim],
      ['b', defaultDim],
    ])
    const result = calculateBoundsFromLocal(['a', 'b'], positions, dims)
    expect(result).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 150,
    })
  })
})

describe('calculateBoundsFromPositions', () => {
  const defaultDim: NodeDimension = { width: 100, height: 50 }

  it('returns null for empty input', () => {
    expect(calculateBoundsFromPositions([], new Map(), new Map(), new Map(), 10)).toBeNull()
  })

  it('adds padding around the bounding box', () => {
    const positions = new Map<string, { x: number; y: number }>([['a', { x: 0, y: 0 }]])
    const dims = new Map<string, NodeDimension>([['a', defaultDim]])
    const result = calculateBoundsFromPositions(['a'], positions, dims, new Map(), 10)
    expect(result).toEqual({
      x: -10,
      y: -10,
      width: 120,
      height: 70,
    })
  })

  it('falls back to default dim when dim not provided', () => {
    const positions = new Map<string, { x: number; y: number }>([['a', { x: 0, y: 0 }]])
    const result = calculateBoundsFromPositions(['a'], positions, new Map(), new Map(), 0)
    expect(result?.width).toBeGreaterThan(0)
  })
})

describe('layoutFamily', () => {
  const baseDims = new Map<string, NodeDimension>([
    ['schema1', { width: 320, height: 400 }],
    ['cn1', { width: 260, height: 100 }],
    ['cn2', { width: 260, height: 100 }],
    ['src1', { width: 280, height: 120 }],
    ['rgx1', { width: 280, height: 120 }],
  ])

  it('places schema in horizontal mode', () => {
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['cn1', 'cn2'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['cn1', 'notNullConstraint'],
        ['cn2', 'uniqueConstraint'],
      ]),
      nodeDimensions: baseDims,
      canvasWidth: 1200,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
    })
    expect(result.localPositions.size).toBeGreaterThan(0)
    expect(result.localPositions.has('schema1')).toBe(true)
    expect(result.localPositions.has('cn1')).toBe(true)
    expect(result.localPositions.has('cn2')).toBe(true)
    expect(result.color).toBeTruthy()
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })

  it('places schema in vertical mode', () => {
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['cn1'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['cn1', 'notNullConstraint'],
      ]),
      nodeDimensions: baseDims,
      canvasWidth: 1200,
      layoutMode: 'vertical',
      gap: 30,
      edges: [],
    })
    expect(result.localPositions.has('schema1')).toBe(true)
    expect(result.localPositions.has('cn1')).toBe(true)
    const schemaPos = result.localPositions.get('schema1')!
    const cnPos = result.localPositions.get('cn1')!
    expect(cnPos.y).toBeGreaterThan(schemaPos.y)
  })

  it('creates subGroups for each constraint type in horizontal mode (no column info fallback)', () => {
    // 无列信息（未传 memberColumnTargetById）时列亲和回退类型分节（伪家族路径）
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['cn1', 'cn2', 'rgx1'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['cn1', 'notNullConstraint'],
        ['cn2', 'uniqueConstraint'],
        ['rgx1', 'regex'],
      ]),
      nodeDimensions: baseDims,
      canvasWidth: 1200,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
    })
    expect(result.subGroups.length).toBeGreaterThan(0)
    const types = result.subGroups.map((sg) => sg.nodeType)
    expect(types).toContain('regex')
  })

  it('handles layout without schema (pseudo-family)', () => {
    const result = layoutFamily({
      familyId: 'orphan',
      familyName: 'Orphan',
      schemaNodeId: null,
      memberNodeIds: ['cn1'],
      nodeTypeById: new Map([['cn1', 'notNullConstraint']]),
      nodeDimensions: new Map([['cn1', { width: 260, height: 100 }]]),
      canvasWidth: 1200,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
    })
    expect(result.localPositions.has('cn1')).toBe(true)
  })

  it('places sources vertically in horizontal mode (left of schema)', () => {
    const dimsWithSource = new Map<string, NodeDimension>([
      ...baseDims.entries(),
      ['src1', { width: 200, height: 100 }],
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['src1', 'cn1'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['src1', 'sourcePreview'],
        ['cn1', 'notNullConstraint'],
      ]),
      nodeDimensions: dimsWithSource,
      canvasWidth: 1200,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
    })
    const srcPos = result.localPositions.get('src1')!
    const schemaPos = result.localPositions.get('schema1')!
    expect(srcPos.x).toBeLessThan(schemaPos.x)
  })

  it('returns minimum width/height for empty family', () => {
    const result = layoutFamily({
      familyId: 'empty',
      familyName: 'Empty',
      schemaNodeId: null,
      memberNodeIds: [],
      nodeTypeById: new Map(),
      nodeDimensions: new Map(),
      canvasWidth: 1200,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
    })
    expect(result.width).toBeGreaterThanOrEqual(500)
    expect(result.height).toBeGreaterThanOrEqual(300)
  })

  it('orders right-area sections by schema column index when column targets provided', () => {
    // 列序：name(1) → email(2) → age(3) → status(4) → score(5)；正则挂 email(2)。
    // 同列两节点故意用"字典序与列序相反"的 ID（m9-age > b2-score），
    // 确保分组若重排字典序该测试能真实检出。
    // 画布足够高时选 1 列，节顺序直接体现为 y 顺序。
    const dims = new Map<string, NodeDimension>([
      ['schema1', { width: 320, height: 400 }],
      ['cn-name', { width: 260, height: 100 }],
      ['cn-email', { width: 260, height: 100 }],
      ['rgx-email', { width: 280, height: 120 }],
      ['m9-age', { width: 260, height: 100 }],
      ['b2-score', { width: 260, height: 100 }],
      ['cn-status', { width: 260, height: 100 }],
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['cn-name', 'cn-email', 'rgx-email', 'm9-age', 'b2-score', 'cn-status'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['cn-name', 'notNullConstraint'],
        ['cn-email', 'uniqueConstraint'],
        ['rgx-email', 'regex'],
        ['m9-age', 'rangeConstraint'],
        ['b2-score', 'rangeConstraint'],
        ['cn-status', 'allowedValuesConstraint'],
      ]),
      nodeDimensions: dims,
      canvasWidth: 1200,
      canvasHeight: 3000,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
      memberColumnTargetById: new Map([
        ['cn-name', makeTarget('c1', 'name', 1)],
        ['cn-email', makeTarget('c2', 'email', 2)],
        ['rgx-email', makeTarget('c2', 'email', 2)],
        ['m9-age', makeTarget('c3', 'age', 3)],
        ['b2-score', makeTarget('c5', 'score', 5)],
        ['cn-status', makeTarget('c4', 'status', 4)],
      ]),
      schemaColumnCount: 6,
    })
    const y = (id: string) => result.localPositions.get(id)!.y
    expect(y('cn-name')).toBeLessThan(y('cn-email'))
    expect(y('cn-email')).toBeLessThan(y('rgx-email'))
    expect(y('rgx-email')).toBeLessThan(y('m9-age'))
    expect(y('m9-age')).toBeLessThan(y('cn-status'))
    // 节序=列序：score(5) 在 status(4) 之后，字典序在此是反着的
    expect(y('cn-status')).toBeLessThan(y('b2-score'))
  })

  it('groups multi-type constraints of the same column into one sub-group titled with the column name', () => {
    const dims = new Map<string, NodeDimension>([
      ['schema1', { width: 320, height: 400 }],
      ['nn-email', { width: 260, height: 100 }],
      ['rg-email', { width: 260, height: 100 }],
      ['uk-email', { width: 260, height: 100 }],
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['nn-email', 'rg-email', 'uk-email'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['nn-email', 'notNullConstraint'],
        ['rg-email', 'rangeConstraint'],
        ['uk-email', 'uniqueConstraint'],
      ]),
      nodeDimensions: dims,
      canvasWidth: 1200,
      canvasHeight: 3000,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
      memberColumnTargetById: new Map([
        ['nn-email', makeTarget('c-email', 'email', 0)],
        ['rg-email', makeTarget('c-email', 'email', 0)],
        ['uk-email', makeTarget('c-email', 'email', 0)],
      ]),
      schemaColumnCount: 1,
    })
    // 同列三种类型 → 单个列节，标题=列名，节内按类型标识排序
    expect(result.subGroups).toHaveLength(1)
    expect(result.subGroups[0]!.name).toBe('email')
    expect(result.subGroups[0]!.nodeIds).toEqual(['nn-email', 'rg-email', 'uk-email'])
    // 同列约束在列内纵向堆叠（同一 x）
    const xs = new Set(
      ['nn-email', 'rg-email', 'uk-email'].map((id) => result.localPositions.get(id)!.x)
    )
    expect(xs.size).toBe(1)
  })

  it('sinks table-level and stale-column constraints into the 表级 section below column sections', () => {
    const dims = new Map<string, NodeDimension>([
      ['schema1', { width: 320, height: 400 }],
      ['cn-name', { width: 260, height: 100 }],
      ['cn-fk', { width: 260, height: 100 }],
      ['cn-stale', { width: 260, height: 100 }],
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['cn-name', 'cn-fk', 'cn-stale'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['cn-name', 'notNullConstraint'],
        ['cn-fk', 'foreignKeyConstraint'],
        ['cn-stale', 'uniqueConstraint'],
      ]),
      nodeDimensions: dims,
      canvasWidth: 1200,
      canvasHeight: 3000,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
      // cn-fk（表级）与 cn-stale（columnId 失效）均无目标 → 表级节
      memberColumnTargetById: new Map([['cn-name', makeTarget('c-name', 'name', 0)]]),
      schemaColumnCount: 2,
    })
    const tableGroup = result.subGroups.find((sg) => sg.name === '表级约束')
    expect(tableGroup).toBeDefined()
    expect(tableGroup!.nodeIds).toEqual(['cn-fk', 'cn-stale'])
    // 沉底：表级节的两个约束都在列节约束之下
    const y = (id: string) => result.localPositions.get(id)!.y
    expect(y('cn-fk')).toBeGreaterThan(y('cn-name'))
    expect(y('cn-stale')).toBeGreaterThan(y('cn-name'))
  })

  it('aligns the first column section band toward its estimated schema row', () => {
    // schema 高 400、4 列：第 0 列行顶估算 = header(120) + 0 ≈ 120，
    // 对齐目标 40 + 120 = 160 > 节带初始游标 40 → 节带被下拉（不超过 slack 120）
    const dims = new Map<string, NodeDimension>([
      ['schema1', { width: 320, height: 400 }],
      ['cn-a', { width: 260, height: 100 }],
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['cn-a'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['cn-a', 'notNullConstraint'],
      ]),
      nodeDimensions: dims,
      canvasWidth: 1200,
      canvasHeight: 3000,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
      memberColumnTargetById: new Map([['cn-a', makeTarget('c-a', 'colA', 0)]]),
      schemaColumnCount: 4,
    })
    expect(result.localPositions.get('cn-a')!.y).toBeGreaterThan(40)
  })

  it("constraintGrouping 'type' keeps legacy type sections when column targets exist", () => {
    const dims = new Map<string, NodeDimension>([
      ['schema1', { width: 320, height: 400 }],
      ['nn-a', { width: 260, height: 100 }],
      ['rg-a', { width: 260, height: 100 }],
      ['uk-b', { width: 260, height: 100 }],
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['nn-a', 'rg-a', 'uk-b'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['nn-a', 'notNullConstraint'],
        ['rg-a', 'rangeConstraint'],
        ['uk-b', 'uniqueConstraint'],
      ]),
      nodeDimensions: dims,
      canvasWidth: 1200,
      canvasHeight: 3000,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
      memberColumnTargetById: new Map([
        ['nn-a', makeTarget('c-a', 'colA', 0)],
        ['rg-a', makeTarget('c-a', 'colA', 0)],
        ['uk-b', makeTarget('c-b', 'colB', 1)],
      ]),
      schemaColumnCount: 2,
      constraintGrouping: 'type',
    })
    // 旧行为：按类型分节（同列两约束被拆到各自类型节），标题=类型显示名
    expect(result.subGroups.map((sg) => sg.name).sort()).toEqual(
      ['唯一约束', '区间约束', '非空约束'].sort()
    )
    expect(result.subGroups.some((sg) => sg.name === 'colA')).toBe(false)
  })

  it('keeps legacy section order when no sort index provided', () => {
    const dims = new Map<string, NodeDimension>([
      ['schema1', { width: 320, height: 400 }],
      ['b-notnull', { width: 260, height: 100 }],
      ['c-unique', { width: 260, height: 100 }],
      ['d-regex', { width: 280, height: 120 }],
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: ['b-notnull', 'c-unique', 'd-regex'],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ['b-notnull', 'notNullConstraint'],
        ['c-unique', 'uniqueConstraint'],
        ['d-regex', 'regex'],
      ]),
      nodeDimensions: dims,
      canvasWidth: 1200,
      canvasHeight: 3000,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
    })
    const y = (id: string) => result.localPositions.get(id)!.y
    // 无列序信息：约束组在前、正则在后（历史行为）
    expect(y('b-notnull')).toBeLessThan(y('c-unique'))
    expect(y('c-unique')).toBeLessThan(y('d-regex'))
  })

  it('packs tall constraint stacks into multiple columns to fit the viewport', () => {
    // 6 种约束各 1 节（纵向 800px），矮视口下应分 2 列而不是堆成长柱
    const types = [
      'notNullConstraint',
      'uniqueConstraint',
      'allowedValuesConstraint',
      'rangeConstraint',
      'charsetConstraint',
      'dateLogicConstraint',
    ]
    const ids = types.map((t, i) => `cn-${i}`)
    const dims = new Map<string, NodeDimension>([
      ['schema1', { width: 320, height: 400 }],
      ...ids.map((id) => [id, { width: 260, height: 100 }] as const),
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: [...ids],
      nodeTypeById: new Map([['schema1', 'schema'], ...types.map((t, i) => [ids[i]!, t] as const)]),
      nodeDimensions: new Map(dims),
      canvasWidth: 1200,
      canvasHeight: 600,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
    })
    const schemaX = result.localPositions.get('schema1')!.x
    const xs = new Set(ids.map((id) => result.localPositions.get(id)!.x))
    expect(xs.size).toBe(2)
    for (const x of xs) {
      expect(x).toBeGreaterThan(schemaX)
    }
    // 分组框仍然按类型成立
    expect(result.subGroups.length).toBe(types.length)
  })

  it('wraps an oversized single section into sub-columns while keeping one group', () => {
    // 6 个同类型约束（纵向 630px）超过换列阈值时，节内换子列且分组框不拆分
    const ids = ['nn-1', 'nn-2', 'nn-3', 'nn-4', 'nn-5', 'nn-6']
    const dims = new Map<string, NodeDimension>([
      ['schema1', { width: 320, height: 400 }],
      ...ids.map((id) => [id, { width: 260, height: 100 }] as const),
    ])
    const result = layoutFamily({
      familyId: 'fam1',
      familyName: 'Family 1',
      schemaNodeId: 'schema1',
      memberNodeIds: [...ids],
      nodeTypeById: new Map([
        ['schema1', 'schema'],
        ...ids.map((id) => [id, 'notNullConstraint'] as const),
      ]),
      nodeDimensions: new Map(dims),
      canvasWidth: 1200,
      canvasHeight: 600,
      layoutMode: 'horizontal',
      gap: 30,
      edges: [],
    })
    const schemaX = result.localPositions.get('schema1')!.x
    const xs = new Set(ids.map((id) => result.localPositions.get(id)!.x))
    expect(xs.size).toBe(2)
    for (const x of xs) {
      expect(x).toBeGreaterThan(schemaX)
    }
    // 前 3 个在第一子列、后 3 个在第二子列
    expect(result.localPositions.get('nn-1')!.x).toBe(result.localPositions.get('nn-3')!.x)
    expect(result.localPositions.get('nn-4')!.x).toBe(result.localPositions.get('nn-6')!.x)
    expect(result.localPositions.get('nn-1')!.x).not.toBe(result.localPositions.get('nn-4')!.x)
    // 分组框仍是 1 个（bounds 反推自落点，包裹成宽框）
    expect(result.subGroups).toHaveLength(1)
    expect(result.subGroups[0]!.nodeIds).toEqual(ids)
  })
})

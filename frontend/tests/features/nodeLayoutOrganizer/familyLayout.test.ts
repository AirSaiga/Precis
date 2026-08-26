import { describe, it, expect } from 'vitest'
import {
  getFallbackDimension,
  groupByType,
  flowLayout,
  calculateBoundsFromLocal,
  calculateBoundsFromPositions,
  layoutFamily,
} from '@/features/node-layout-organizer/strategies/familyLayout'
import type { NodeDimension } from '@/features/node-layout-organizer/utils/nodeDimensionHelper'
import { NODE_DIMENSIONS } from '@/features/node-layout-organizer/constants'

describe('getFallbackDimension', () => {
  it('returns schema-specific dimensions for schema', () => {
    const dim = getFallbackDimension('schema')
    expect(dim.width).toBe(320)
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

  it('creates subGroups for each constraint type in horizontal mode', () => {
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

  it('orders right-area sections by schema column index when sort index provided', () => {
    // 列序：name(1) → email(2) → age(3) → status(4)；正则挂 email(2)。
    // 同类型两节点故意用"字典序与列序相反"的 ID（m9-age > b2-score），
    // 确保 groupByType 若重排字典序该测试能真实检出。
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
      memberSortIndexById: new Map([
        ['cn-name', 1],
        ['cn-email', 2],
        ['rgx-email', 2],
        ['m9-age', 3],
        ['b2-score', 5],
        ['cn-status', 4],
      ]),
    })
    const y = (id: string) => result.localPositions.get(id)!.y
    expect(y('cn-name')).toBeLessThan(y('cn-email'))
    expect(y('cn-email')).toBeLessThan(y('rgx-email'))
    expect(y('rgx-email')).toBeLessThan(y('m9-age'))
    expect(y('m9-age')).toBeLessThan(y('cn-status'))
    // 同类型节内也按列序排（age 在 score 前），字典序在此是反着的
    expect(y('m9-age')).toBeLessThan(y('b2-score'))
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

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

  it('sorts node IDs alphabetically within each type group', () => {
    const nodeTypeById = new Map<string, string>([
      ['c', 'notNull'],
      ['a', 'notNull'],
      ['b', 'notNull'],
    ])
    const result = groupByType(['c', 'a', 'b'], nodeTypeById)
    expect(result.get('notNull')).toEqual(['a', 'b', 'c'])
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
    const positions = new Map<string, { x: number; y: number }>([
      ['a', { x: 0, y: 0 }],
    ])
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
    const positions = new Map<string, { x: number; y: number }>([
      ['a', { x: 0, y: 0 }],
    ])
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
})

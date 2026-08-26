import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LayoutCalculator } from '@/features/node-layout-organizer/core/layoutCalculator'
import type { CustomNode } from '@/types/nodes'
import type { OrganizeOptions, ConnectionInfo } from '@/features/node-layout-organizer/types'

function makeNode(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  position = { x: 0, y: 0 }
): CustomNode {
  return {
    id,
    type: type as CustomNode['type'],
    position,
    data: data as CustomNode['data'],
  }
}

const defaultOptions: OrganizeOptions = {
  animate: false,
  animateDuration: 0,
  gap: 30,
  margin: 40,
}

describe('LayoutCalculator - basic', () => {
  beforeEach(() => {
    // 默认 mock navigator 为 Windows
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty position map for empty nodes', () => {
    const calc = new LayoutCalculator([], [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    expect(positions.size).toBe(0)
  })

  it('returns a position entry for each classified node', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema'), makeNode('node-s2', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    expect(positions.size).toBe(2)
    expect(positions.has('node-s1')).toBe(true)
    expect(positions.has('node-s2')).toBe(true)
  })

  it('returns positions snapped to grid (multiples of DEFAULT_GAP)', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    const pos = positions.get('node-s1')!
    const defaultGap = 30
    expect(pos.x % defaultGap).toBe(0)
    expect(pos.y % defaultGap).toBe(0)
  })

  it('produces distinct positions for each node', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema'), makeNode('node-s2', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    const a = positions.get('node-s1')!
    const b = positions.get('node-s2')!
    expect(a.x === b.x && a.y === b.y).toBe(false)
  })

  it('exposes groups list after calculate', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    calc.calculate()
    const groups = calc.getGroups()
    expect(Array.isArray(groups)).toBe(true)
  })

  it('respects viewportZoom in constructor', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions, 0.5)
    expect(() => calc.calculate()).not.toThrow()
  })
})

describe('LayoutCalculator - node classification', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  it('classifies nodes by type into internal groups', () => {
    const nodes: CustomNode[] = [
      makeNode('node-s1', 'schema'),
      makeNode('node-cn1', 'notNullConstraint'),
      makeNode('node-cn2', 'uniqueConstraint'),
    ]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    calc.calculate()
    // 内部 classification 是私有，但 calculate 的输出反映了分类
    const positions = calc.calculate()
    expect(positions.size).toBe(3)
  })

  it('handles mixed constraint types', () => {
    const nodes: CustomNode[] = [
      makeNode('node-s1', 'schema'),
      makeNode('node-cn1', 'notNullConstraint'),
      makeNode('node-cn2', 'uniqueConstraint'),
      makeNode('node-cn3', 'rangeConstraint'),
    ]
    const calc = new LayoutCalculator(nodes, [], { width: 2000, height: 1000 }, defaultOptions)
    const positions = calc.calculate()
    expect(positions.size).toBe(4)
  })

  it('places root nodes in the reserved top row, above the schema family', () => {
    const nodes: CustomNode[] = [
      makeNode('node-root', 'projectRoot'),
      makeNode('node-s1', 'schema'),
    ]
    const calc = new LayoutCalculator(nodes, [], { width: 1000, height: 800 }, defaultOptions)
    const positions = calc.calculate()
    const rootPos = positions.get('node-root')
    const schemaPos = positions.get('node-s1')
    expect(rootPos).toBeDefined()
    expect(schemaPos).toBeDefined()
    expect(rootPos!.y).toBeLessThan(schemaPos!.y)
  })
})

describe('LayoutCalculator - with connections', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  it('processes connections without error', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema'), makeNode('node-s2', 'schema')]
    const connections: ConnectionInfo[] = [
      { source: 'node-s1', target: 'node-s2', sourceType: 'schema', targetType: 'schema' },
    ]
    const calc = new LayoutCalculator(
      nodes,
      connections,
      { width: 2000, height: 1000 },
      defaultOptions
    )
    const positions = calc.calculate()
    expect(positions.size).toBe(2)
  })
})

describe('LayoutCalculator - schema family wiring (classifyNodes 回归)', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32', language: 'en-US' },
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('forms the schema family with three-band ordering: source | schema | constraints', () => {
    // 回归守卫：classifyNodes 曾因 Map 条目未初始化而恒产空分类，
    // 导致 Schema 中心化策略整体退化为"未分组节点"流式缠绕布局。
    const schemaId = 'node-schema-1'
    const nodes: CustomNode[] = [
      makeNode('node-src', 'sourcePreview'),
      makeNode(schemaId, 'schema'),
      makeNode('node-cn1', 'rangeConstraint', { parent: schemaId }),
    ]
    const connections: ConnectionInfo[] = [
      { source: 'node-src', target: schemaId, sourceType: 'sourcePreview', targetType: 'schema' },
    ]
    const calc = new LayoutCalculator(
      nodes,
      connections,
      { width: 2000, height: 1000 },
      defaultOptions
    )
    const positions = calc.calculate()

    expect(calc.getGroups().some((g) => g.id === `fam-${schemaId}`)).toBe(true)
    expect(positions.get('node-src')!.x).toBeLessThan(positions.get(schemaId)!.x)
    expect(positions.get(schemaId)!.x).toBeLessThan(positions.get('node-cn1')!.x)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SchemaCentricStrategy } from '@/features/node-layout-organizer/strategies/schemaCentricStrategy'
import {
  NodeCategory,
  NODE_TYPE_TO_CATEGORY,
  type NodeClassification,
  type LayoutContext,
  type ConnectionInfo,
} from '@/features/node-layout-organizer/types'
import type { CustomNode } from '@/types/nodes'

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return {
    id,
    type: type as CustomNode['type'],
    position: { x: 0, y: 0 },
    data: data as CustomNode['data'],
  }
}

function makeClassification(nodes: CustomNode[]): NodeClassification {
  const byCategory = new Map<NodeCategory, string[]>()
  const byType = new Map<string, string[]>()
  const unclassified: string[] = []

  for (const node of nodes) {
    if (!node.type) {
      unclassified.push(node.id)
      continue
    }
    const category = NODE_TYPE_TO_CATEGORY[node.type]
    if (!category) {
      unclassified.push(node.id)
      continue
    }
    if (!byCategory.has(category)) byCategory.set(category, [])
    byCategory.get(category)!.push(node.id)
    if (!byType.has(node.type)) byType.set(node.type, [])
    byType.get(node.type)!.push(node.id)
  }

  return { byCategory, byType, unclassified }
}

function makeContext(nodes: CustomNode[], connections: ConnectionInfo[] = []): LayoutContext {
  return {
    canvasWidth: 1200,
    canvasHeight: 800,
    nodes: nodes.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: 0,
      height: 0,
    })),
    nodeDataById: new Map(nodes.map((n) => [n.id, n])),
    connections,
    gap: 30,
  }
}

describe('SchemaCentricStrategy - calculate', () => {
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

  it('returns empty positions for empty input', () => {
    const strategy = new SchemaCentricStrategy()
    const result = strategy.calculate(
      { byCategory: new Map(), byType: new Map(), unclassified: [] },
      [],
      makeContext([])
    )
    expect(result.positions.size).toBe(0)
    expect(result.groups).toEqual([])
  })

  it('assigns position to schema nodes', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const strategy = new SchemaCentricStrategy()
    const result = strategy.calculate(
      makeClassification(nodes),
      [],
      makeContext(nodes)
    )
    expect(result.positions.has('node-s1')).toBe(true)
  })

  it('groups schema nodes into a group', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const strategy = new SchemaCentricStrategy()
    const result = strategy.calculate(
      makeClassification(nodes),
      [],
      makeContext(nodes)
    )
    const schemaGroups = result.groups.filter((g) => g.id === 'fam-node-s1')
    expect(schemaGroups).toHaveLength(1)
  })

  it('places root nodes above schema nodes', () => {
    const nodes: CustomNode[] = [
      makeNode('node-root', 'projectRoot'),
      makeNode('node-s1', 'schema'),
    ]
    const strategy = new SchemaCentricStrategy()
    const result = strategy.calculate(
      makeClassification(nodes),
      [],
      makeContext(nodes)
    )
    const rootPos = result.positions.get('node-root')!
    const schemaPos = result.positions.get('node-s1')!
    expect(rootPos.y).toBeLessThan(schemaPos.y)
  })

  it('creates shared group for nodes connecting to multiple schemas', () => {
    const nodes: CustomNode[] = [
      makeNode('node-s1', 'schema'),
      makeNode('node-s2', 'schema'),
      makeNode('node-shared', 'regex'),
    ]
    const connections: ConnectionInfo[] = [
      { source: 'node-shared', target: 'node-s1', sourceType: 'regex', targetType: 'schema' },
      { source: 'node-shared', target: 'node-s2', sourceType: 'regex', targetType: 'schema' },
    ]
    const strategy = new SchemaCentricStrategy()
    const result = strategy.calculate(
      makeClassification(nodes),
      connections,
      makeContext(nodes, connections)
    )
    const sharedGroup = result.groups.find((g) => g.id === 'fam-shared')
    expect(sharedGroup).toBeDefined()
  })

  it('assigns orphan nodes without connections to orphan group', () => {
    const nodes: CustomNode[] = [
      makeNode('node-s1', 'schema'),
      makeNode('node-orphan', 'regex'),
    ]
    const strategy = new SchemaCentricStrategy()
    const result = strategy.calculate(
      makeClassification(nodes),
      [],
      makeContext(nodes)
    )
    const orphanGroup = result.groups.find((g) => g.id === 'fam-orphan')
    expect(orphanGroup).toBeDefined()
  })

  it('respects viewportZoom', () => {
    const nodes: CustomNode[] = [makeNode('node-s1', 'schema')]
    const strategy = new SchemaCentricStrategy()
    const ctx = makeContext(nodes)
    ctx.viewportZoom = 0.5
    expect(() => strategy.calculate(makeClassification(nodes), [], ctx)).not.toThrow()
  })

  it('returns positions that may not yet be grid-snapped (LayoutCalculator does the snapping)', () => {
    const nodes: CustomNode[] = [
      makeNode('node-s1', 'schema'),
      makeNode('node-cn1', 'notNullConstraint'),
    ]
    const strategy = new SchemaCentricStrategy()
    const result = strategy.calculate(
      makeClassification(nodes),
      [],
      makeContext(nodes)
    )
    // 策略层返回的坐标是原始计算结果，网格对齐由 LayoutCalculator 完成
    for (const pos of result.positions.values()) {
      expect(typeof pos.x).toBe('number')
      expect(typeof pos.y).toBe('number')
    }
  })

  it('creates sub-groups for constraints within a family', () => {
    // 约束节点的 data.parent 必须指向 schema 才能被归入对应 family
    const nodes: CustomNode[] = [
      makeNode('node-s1', 'schema'),
      makeNode('node-cn1', 'notNullConstraint', { parent: 'node-s1' }),
      makeNode('node-cn2', 'uniqueConstraint', { parent: 'node-s1' }),
    ]
    const strategy = new SchemaCentricStrategy()
    const result = strategy.calculate(
      makeClassification(nodes),
      [],
      makeContext(nodes)
    )
    const familyGroup = result.groups.find((g) => g.id === 'fam-node-s1')
    expect(familyGroup).toBeDefined()
    if (familyGroup) {
      const subGroups = result.groups.filter((g) => g.parentId === familyGroup.id)
      expect(subGroups.length).toBeGreaterThan(0)
    }
  })
})

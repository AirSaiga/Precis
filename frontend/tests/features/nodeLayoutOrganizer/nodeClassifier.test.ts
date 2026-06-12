import { describe, it, expect, beforeEach } from 'vitest'
import { NodeClassifier } from '@/features/node-layout-organizer/utils/nodeClassifier'
import { NodeCategory, NODE_TYPE_TO_CATEGORY } from '@/features/node-layout-organizer/types'
import type { CustomNode } from '@/types/nodes'

function makeNode(
  id: string,
  type: string | undefined,
  data: Record<string, unknown> = {}
): CustomNode {
  return {
    id,
    type: type as CustomNode['type'],
    position: { x: 0, y: 0 },
    data: data as CustomNode['data'],
  }
}

describe('NodeClassifier - classifyByCategory', () => {
  it('groups nodes by their category', () => {
    const nodes: CustomNode[] = [
      makeNode('root', 'projectRoot'),
      makeNode('schema1', 'schema'),
      makeNode('schema2', 'jsonSchema'),
      makeNode('cn1', 'notNullConstraint'),
      makeNode('cn2', 'uniqueConstraint'),
    ]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByCategory()
    expect(result.get(NodeCategory.ROOT)).toHaveLength(1)
    expect(result.get(NodeCategory.CORE)).toHaveLength(2)
    expect(result.get(NodeCategory.CONSTRAINT)).toHaveLength(2)
  })

  it('returns empty map for empty input', () => {
    const classifier = new NodeClassifier([])
    const result = classifier.classifyByCategory()
    expect(result.size).toBe(0)
  })

  it('falls back to CORE for unknown node types', () => {
    const nodes: CustomNode[] = [makeNode('n1', 'totallyUnknownType' as string)]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByCategory()
    expect(result.get(NodeCategory.CORE)).toHaveLength(1)
  })

  it('skips nodes without type', () => {
    const nodes: CustomNode[] = [makeNode('n1', undefined), makeNode('n2', 'schema')]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByCategory()
    expect(result.get(NodeCategory.CORE)).toHaveLength(1)
    expect(result.get(NodeCategory.CORE)?.[0]?.id).toBe('n2')
  })
})

describe('NodeClassifier - classifyByType', () => {
  it('groups nodes by exact type string', () => {
    const nodes: CustomNode[] = [
      makeNode('s1', 'schema'),
      makeNode('s2', 'schema'),
      makeNode('cn1', 'notNullConstraint'),
    ]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByType()
    expect(result.get('schema')).toHaveLength(2)
    expect(result.get('notNullConstraint')).toHaveLength(1)
  })

  it('skips nodes without type', () => {
    const nodes: CustomNode[] = [makeNode('n1', undefined), makeNode('n2', 'schema')]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByType()
    expect(result.get('schema')).toHaveLength(1)
    expect(result.size).toBe(1)
  })

  it('returns empty map for empty input', () => {
    const classifier = new NodeClassifier([])
    const result = classifier.classifyByType()
    expect(result.size).toBe(0)
  })
})

describe('NodeClassifier - classifyByConnection', () => {
  it('classifies isolated nodes (no schema connections)', () => {
    const nodes: CustomNode[] = [
      makeNode('a', 'schema', { foo: 'bar' }),
      makeNode('b', 'notNullConstraint', { target: 'node-a' }),
    ]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByConnection()
    expect(result.isolated).toHaveLength(2)
    expect(result.sources.size).toBe(0)
  })

  it('identifies source nodes pointing to existing schema', () => {
    // 节点 ID 需使用 'node-' 前缀以匹配 extractSchemaNodeIds 的解析
    const nodes: CustomNode[] = [
      makeNode('node-schema-1', 'schema'),
      makeNode('node-cn-1', 'notNullConstraint', { target: 'node-schema-1' }),
    ]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByConnection()
    expect(result.sources.has('node-cn-1')).toBe(true)
    expect(result.targets.has('node-schema-1')).toBe(true)
    expect(result.isolated).toHaveLength(0)
  })

  it('classifies nodes with 3+ connections as hubs', () => {
    const nodes: CustomNode[] = [
      makeNode('node-h', 'schema'),
      makeNode('node-c1', 'notNullConstraint', { target: 'node-h' }),
      makeNode('node-c2', 'uniqueConstraint', { target: 'node-h' }),
      makeNode('node-c3', 'rangeConstraint', { target: 'node-h' }),
    ]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByConnection()
    expect(result.hubs.find((n) => n.id === 'node-h')).toBeDefined()
  })

  it('deduplicates schema references within a node', () => {
    const nodes: CustomNode[] = [
      makeNode('node-s', 'schema'),
      makeNode('node-c', 'notNullConstraint', {
        target: 'node-s',
        extra: { ref: 'node-s' },
      }),
    ]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByConnection()
    expect(result.sources.size).toBe(1)
    expect(result.targets.size).toBe(1)
  })

  it('ignores references to non-existent schema nodes', () => {
    const nodes: CustomNode[] = [
      makeNode('node-c', 'notNullConstraint', { target: 'node-does-not-exist' }),
    ]
    const classifier = new NodeClassifier(nodes)
    const result = classifier.classifyByConnection()
    expect(result.sources.size).toBe(0)
    expect(result.targets.size).toBe(0)
    expect(result.isolated).toHaveLength(1)
  })
})

describe('NodeClassifier - classifyByHierarchy', () => {
  it('places all disconnected nodes at level 0', () => {
    const nodes: CustomNode[] = [makeNode('a', 'schema'), makeNode('b', 'schema')]
    const classifier = new NodeClassifier(nodes)
    const levels = classifier.classifyByHierarchy([])
    expect(levels.get(0)).toHaveLength(2)
  })

  it('assigns increasing levels along chain', () => {
    const nodes: CustomNode[] = [
      makeNode('a', 'schema'),
      makeNode('b', 'schema'),
      makeNode('c', 'schema'),
    ]
    const classifier = new NodeClassifier(nodes)
    const levels = classifier.classifyByHierarchy([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ])
    expect(levels.get(0)).toHaveLength(1)
    expect(levels.get(0)?.[0]?.id).toBe('a')
    expect(levels.get(1)).toHaveLength(1)
    expect(levels.get(1)?.[0]?.id).toBe('b')
    expect(levels.get(2)).toHaveLength(1)
    expect(levels.get(2)?.[0]?.id).toBe('c')
  })

  it('handles branching (max parent level + 1)', () => {
    const nodes: CustomNode[] = [
      makeNode('a', 'schema'),
      makeNode('b', 'schema'),
      makeNode('c', 'schema'),
      makeNode('d', 'schema'),
    ]
    const classifier = new NodeClassifier(nodes)
    const levels = classifier.classifyByHierarchy([
      { source: 'a', target: 'c' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ])
    expect(levels.get(0)).toHaveLength(2)
    expect(levels.get(1)).toHaveLength(1)
    expect(levels.get(2)).toHaveLength(1)
  })
})

describe('NodeClassifier - getRootNodes / getLeafNodes', () => {
  it('getRootNodes returns projectRoot nodes', () => {
    const nodes: CustomNode[] = [makeNode('root1', 'projectRoot'), makeNode('s', 'schema')]
    const classifier = new NodeClassifier(nodes)
    const roots = classifier.getRootNodes()
    expect(roots).toHaveLength(1)
    expect(roots[0]?.id).toBe('root1')
  })

  it('getLeafNodes returns nodes with no schema connection', () => {
    const nodes: CustomNode[] = [
      makeNode('node-a', 'schema'),
      makeNode('node-b', 'notNullConstraint', { target: 'node-a' }),
      makeNode('orphan', 'regex'),
    ]
    const classifier = new NodeClassifier(nodes)
    const leaves = classifier.getLeafNodes()
    expect(leaves).toHaveLength(2)
    expect(leaves.map((n) => n.id).sort()).toEqual(['node-a', 'orphan'])
  })
})

describe('NodeClassifier - getStatistics', () => {
  it('returns counts across all dimensions', () => {
    const nodes: CustomNode[] = [
      makeNode('root', 'projectRoot'),
      makeNode('node-s1', 'schema'),
      makeNode('node-s2', 'schema'),
      makeNode('node-cn1', 'notNullConstraint', { target: 'node-s1' }),
      makeNode('isolated', 'regex'),
    ]
    const classifier = new NodeClassifier(nodes)
    const stats = classifier.getStatistics()
    expect(stats.total).toBe(5)
    expect(stats.byCategory[NodeCategory.ROOT]).toBe(1)
    expect(stats.byCategory[NodeCategory.CORE]).toBe(3)
    expect(stats.byCategory[NodeCategory.CONSTRAINT]).toBe(1)
    expect(stats.byType['schema']).toBe(2)
    expect(stats.byType['notNullConstraint']).toBe(1)
    // root, node-s2, isolated 三个节点无连接 → isolated = 3
    expect(stats.isolated).toBe(3)
  })

  it('handles empty input', () => {
    const classifier = new NodeClassifier([])
    const stats = classifier.getStatistics()
    expect(stats.total).toBe(0)
    expect(stats.isolated).toBe(0)
  })
})

describe('NODE_TYPE_TO_CATEGORY mapping', () => {
  it('maps projectRoot to ROOT', () => {
    expect(NODE_TYPE_TO_CATEGORY['projectRoot']).toBe(NodeCategory.ROOT)
  })

  it('maps schema, sourcePreview, jsonSchema, regex to CORE', () => {
    expect(NODE_TYPE_TO_CATEGORY['schema']).toBe(NodeCategory.CORE)
    expect(NODE_TYPE_TO_CATEGORY['sourcePreview']).toBe(NodeCategory.CORE)
    expect(NODE_TYPE_TO_CATEGORY['jsonSchema']).toBe(NodeCategory.CORE)
    expect(NODE_TYPE_TO_CATEGORY['regex']).toBe(NodeCategory.CORE)
  })

  it('maps all constraint types to CONSTRAINT', () => {
    const constraintTypes = [
      'constraint',
      'notNullConstraint',
      'uniqueConstraint',
      'foreignKeyConstraint',
      'allowedValuesConstraint',
      'conditionalConstraint',
      'scriptedConstraint',
      'rangeConstraint',
      'charsetConstraint',
      'dateLogicConstraint',
      'compositeConstraint',
    ]
    for (const type of constraintTypes) {
      expect(NODE_TYPE_TO_CATEGORY[type]).toBe(NodeCategory.CONSTRAINT)
    }
  })
})

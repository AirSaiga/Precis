/**
 * X03 注入行为测试（golden-master）— 由 verify.mjs 临时复制进 frontend/tests/，跑完即删。
 *
 * 两道断言层次：
 * 1. 提取出的 connectionTypeRules 模块：5 个函数的全类型真值表 + 4 个常量集合的精确成员
 *    （断言"提取后功能与原实现逐字节等价"）
 * 2. createConnectionStateSyncModule：固定图场景的精确 patch 序列（golden-master，
 *    断言接线后模块对外行为与重构前完全一致）
 */
import { describe, it, expect } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import {
  CHILDREN_CAPABLE_TYPES,
  DATA_SOURCE_TYPES,
  SCHEMA_TYPES,
  SKIP_EDGE_KINDS,
  isChildrenCapableType,
  isParentCapableType,
  isDataSourceType,
  isSchemaType,
  shouldSkipEdge,
} from '@/stores/graphStore/modules/connectionTypeRules'
import { createConnectionStateSyncModule } from '@/stores/graphStore/modules/connectionStateSync'
import type { CustomNode, CustomNodeData } from '@/types/graph'

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): CustomNode {
  return { id, type, position: { x: 0, y: 0 }, data: data as CustomNodeData } as CustomNode
}

function makeEdge(id: string, source: string, target: string, data?: Record<string, unknown>): Edge {
  return { id, source, target, ...(data ? { data } : {}) } as Edge
}

function createTestContext(nodesInit: CustomNode[], edgesInit: Edge[]) {
  const nodesRef = ref(nodesInit) as Ref<CustomNode[]>
  const edgesRef = ref(edgesInit) as Ref<Edge[]>
  const patches: Array<{ nodeId: string; data: Record<string, unknown> }> = []
  const updateNodeData = (nodeId: string, newData: Partial<CustomNodeData>) => {
    patches.push({ nodeId, data: newData as Record<string, unknown> })
    nodesRef.value = nodesRef.value.map((n) =>
      n.id === nodeId ? ({ ...n, data: { ...n.data, ...newData } } as CustomNode) : n
    )
  }
  const module = createConnectionStateSyncModule({ nodes: nodesRef, edges: edgesRef, updateNodeData })
  return { nodesRef, edgesRef, patches, module }
}

const CONSTRAINT_NODE_TYPES = [
  'notNullConstraint',
  'uniqueConstraint',
  'foreignKeyConstraint',
  'allowedValuesConstraint',
  'rangeConstraint',
  'conditionalConstraint',
  'scriptedConstraint',
  'charsetConstraint',
  'dateLogicConstraint',
  'compositeConstraint',
]

describe('X03 golden-master: connectionTypeRules 提取后行为等价', () => {
  describe('常量集合成员', () => {
    it('CHILDREN_CAPABLE_TYPES 精确 6 成员', () => {
      expect(CHILDREN_CAPABLE_TYPES instanceof Set).toBe(true)
      expect(CHILDREN_CAPABLE_TYPES.size).toBe(6)
      for (const t of ['sourcePreview', 'jsonSourcePreview', 'schema', 'jsonSchema', 'manualData', 'transformOutput']) {
        expect(CHILDREN_CAPABLE_TYPES.has(t)).toBe(true)
      }
    })

    it('DATA_SOURCE_TYPES 精确 2 成员', () => {
      expect(DATA_SOURCE_TYPES.size).toBe(2)
      expect(DATA_SOURCE_TYPES.has('sourcePreview')).toBe(true)
      expect(DATA_SOURCE_TYPES.has('jsonSourcePreview')).toBe(true)
    })

    it('SCHEMA_TYPES 精确 2 成员', () => {
      expect(SCHEMA_TYPES.size).toBe(2)
      expect(SCHEMA_TYPES.has('schema')).toBe(true)
      expect(SCHEMA_TYPES.has('jsonSchema')).toBe(true)
    })

    it('SKIP_EDGE_KINDS 仅含 fkDisplay', () => {
      expect(SKIP_EDGE_KINDS.size).toBe(1)
      expect(SKIP_EDGE_KINDS.has('fkDisplay')).toBe(true)
    })
  })

  describe('isChildrenCapableType 全类型真值表', () => {
    it.each([
      ['sourcePreview', true],
      ['jsonSourcePreview', true],
      ['schema', true],
      ['jsonSchema', true],
      ['manualData', true],
      ['transformOutput', true],
      ['transform', false],
      ['projectRoot', false],
      ['regex', false],
      ['regexExtract', false],
      ['templateInstance', false],
      ['notNullConstraint', false],
      ['compositeConstraint', false],
      ['', false],
      [undefined, false],
    ])('type=%s → %s', (type, expected) => {
      expect(isChildrenCapableType(type)).toBe(expected)
    })
  })

  describe('isParentCapableType 全类型真值表', () => {
    it.each([
      ['regex', true],
      ['regexExtract', true],
      ...CONSTRAINT_NODE_TYPES.map((t): [string, boolean] => [t, true]),
      ['schema', false],
      ['jsonSchema', false],
      ['sourcePreview', false],
      ['jsonSourcePreview', false],
      ['manualData', false],
      ['transformOutput', false],
      ['projectRoot', false],
      ['', false],
      [undefined, false],
    ])('type=%s → %s', (type, expected) => {
      expect(isParentCapableType(type)).toBe(expected)
    })
  })

  describe('isDataSourceType / isSchemaType 真值表', () => {
    it.each([
      ['sourcePreview', true, false],
      ['jsonSourcePreview', true, false],
      ['schema', false, true],
      ['jsonSchema', false, true],
      ['manualData', false, false],
      ['transformOutput', false, false],
      ['regex', false, false],
      [undefined, false, false],
    ])('type=%s → dataSource=%s schema=%s', (type, ds, sc) => {
      expect(isDataSourceType(type)).toBe(ds)
      expect(isSchemaType(type)).toBe(sc)
    })
  })

  describe('shouldSkipEdge 真值表', () => {
    it.each([
      [{}, false],
      [{ data: {} }, false],
      [{ data: { transient: true } }, true],
      [{ data: { transient: false } }, false],
      [{ data: { kind: 'fkDisplay' } }, true],
      [{ data: { kind: 'normal' } }, false],
      [{ data: { transient: false, kind: 'fkDisplay' } }, true],
    ])('edge=%j → %s', (partial, expected) => {
      expect(shouldSkipEdge({ id: 'e', source: 'a', target: 'b', ...partial } as Edge)).toBe(expected)
    })
  })

  describe('模块接线 golden-master：固定图场景精确 patch 序列', () => {
    it('reconcileAll 对 sp1→s1→c1 固定图产生精确 3 条 patch', async () => {
      const sp1 = makeNode('sp1', 'sourcePreview', {})
      const s1 = makeNode('s1', 'schema', { columns: [] })
      const c1 = makeNode('c1', 'notNullConstraint', {})
      const edges = [makeEdge('e1', 'sp1', 's1'), makeEdge('e2', 's1', 'c1')]
      const { nodesRef, patches, module } = createTestContext([sp1, s1, c1], edges)

      await module.reconcileAll()

      expect(patches).toHaveLength(3)
      expect(patches).toContainEqual({
        nodeId: 'sp1',
        data: { outputPortConnected: true, children: ['s1'] },
      })
      expect(patches).toContainEqual({ nodeId: 's1', data: { children: ['c1'] } })
      expect(patches).toContainEqual({ nodeId: 'c1', data: { parent: 's1' } })

      const finalSp1 = nodesRef.value.find((n) => n.id === 'sp1')
      const finalC1 = nodesRef.value.find((n) => n.id === 'c1')
      expect((finalSp1?.data as Record<string, unknown>).outputPortConnected).toBe(true)
      expect((finalC1?.data as Record<string, unknown>).parent).toBe('s1')
    })

    it('syncOnConnect 数据源→schema 精确 patch（children + outputPortConnected，无 parent）', () => {
      const sp1 = makeNode('sp1', 'sourcePreview', {})
      const s1 = makeNode('s1', 'schema', { columns: [] })
      const { patches, module } = createTestContext([sp1, s1], [])

      module.syncOnConnect('sp1', 's1')

      expect(patches).toHaveLength(2)
      expect(patches).toContainEqual({ nodeId: 'sp1', data: { children: ['s1'] } })
      expect(patches).toContainEqual({ nodeId: 'sp1', data: { outputPortConnected: true } })
    })

    it('syncOnDisconnect 跳过 fkDisplay 边（0 条 patch），普通边精确清理', () => {
      const s1 = makeNode('s1', 'schema', { columns: [], children: ['c1'] })
      const c1 = makeNode('c1', 'notNullConstraint', { parent: 's1' })
      const fkEdge = makeEdge('efk', 's1', 'c1', { kind: 'fkDisplay' })
      const { patches, module } = createTestContext([s1, c1], [fkEdge])

      module.syncOnDisconnect(fkEdge)
      expect(patches).toHaveLength(0)

      const normalEdge = makeEdge('e2', 's1', 'c1')
      module.syncOnDisconnect(normalEdge)
      expect(patches).toHaveLength(2)
      expect(patches).toContainEqual({ nodeId: 's1', data: { children: undefined } })
      expect(patches).toContainEqual({ nodeId: 'c1', data: { parent: undefined } })
    })

    it('reconcileAll 跳过 transient 边（不重建 children）', async () => {
      const s1 = makeNode('s1', 'schema', { columns: [] })
      const c1 = makeNode('c1', 'notNullConstraint', {})
      const edges = [makeEdge('e1', 's1', 'c1', { transient: true })]
      const { nodesRef, module } = createTestContext([s1, c1], edges)

      await module.reconcileAll()

      const finalS1 = nodesRef.value.find((n) => n.id === 's1')
      expect((finalS1?.data as Record<string, unknown>).children).toBeUndefined()
    })
  })
})

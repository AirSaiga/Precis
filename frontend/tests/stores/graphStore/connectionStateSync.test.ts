/**
 * @fileoverview connectionStateSync 模块单元测试
 *
 * 测试 syncOnConnect / syncOnDisconnect / reconcileAll 三个核心方法
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
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
  const patches: Array<{ nodeId: string; data: Partial<CustomNodeData> }> = []

  const updateNodeData = (nodeId: string, newData: Partial<CustomNodeData>) => {
    patches.push({ nodeId, data: newData })
    nodesRef.value = nodesRef.value.map((n) => {
      if (n.id !== nodeId) return n
      return { ...n, data: { ...n.data, ...newData } } as CustomNode
    })
  }

  const module = createConnectionStateSyncModule({
    nodes: nodesRef,
    edges: edgesRef,
    updateNodeData,
  })

  return { nodesRef, edgesRef, patches, module }
}

describe('connectionStateSync', () => {
  describe('syncOnConnect', () => {
    it('schema → notNullConstraint: 设置 source.children 和 target.parent', () => {
      const schema = makeNode('s1', 'schema', { columns: [] })
      const constraint = makeNode('c1', 'notNullConstraint')
      const { module, patches } = createTestContext([schema, constraint], [])

      module.syncOnConnect('s1', 'c1')

      expect(patches).toContainEqual({ nodeId: 's1', data: { children: ['c1'] } })
      expect(patches).toContainEqual({ nodeId: 'c1', data: { parent: 's1' } })
    })

    it('sourcePreview → schema: 设置 children 和 outputPortConnected（schema 非 parent-capable，不设置 parent）', () => {
      const source = makeNode('sp1', 'sourcePreview', {})
      const schema = makeNode('s1', 'schema', { columns: [] })
      const { module, patches } = createTestContext([source, schema], [])

      module.syncOnConnect('sp1', 's1')

      expect(patches).toContainEqual({ nodeId: 'sp1', data: { children: ['s1'] } })
      expect(patches).toContainEqual({ nodeId: 'sp1', data: { outputPortConnected: true } })
      const parentPatch = patches.find((p) => p.nodeId === 's1')
      expect(parentPatch).toBeUndefined()
    })

    it('不重复添加已有 children', () => {
      const schema = makeNode('s1', 'schema', { columns: [], children: ['c1'] })
      const constraint = makeNode('c1', 'notNullConstraint')
      const { module, patches } = createTestContext([schema, constraint], [])

      module.syncOnConnect('s1', 'c1')

      const childPatch = patches.find((p) => p.nodeId === 's1' && 'children' in (p.data as Record<string, unknown>))
      expect(childPatch).toBeUndefined()
    })
  })

  describe('syncOnDisconnect', () => {
    it('断开后清理 children/parent', () => {
      const schema = makeNode('s1', 'schema', { columns: [], children: ['c1'] })
      const constraint = makeNode('c1', 'notNullConstraint', { parent: 's1' })
      const edge = makeEdge('e1', 's1', 'c1')
      const { module, patches, edgesRef } = createTestContext([schema, constraint], [edge])

      module.syncOnDisconnect(edgesRef.value[0])

      expect(patches).toContainEqual({ nodeId: 's1', data: { children: undefined } })
      expect(patches).toContainEqual({ nodeId: 'c1', data: { parent: undefined } })
    })

    it('跳过 FK 展示边', () => {
      const schema = makeNode('s1', 'schema', { columns: [] })
      const constraint = makeNode('c1', 'foreignKeyConstraint', {})
      const edge = makeEdge('e1', 's1', 'c1', { kind: 'fkDisplay' })
      const { module, patches } = createTestContext([schema, constraint], [edge])

      module.syncOnDisconnect(edge)

      expect(patches).toHaveLength(0)
    })

    it('断开数据源连接时重置 outputPortConnected（无剩余连接）', () => {
      const source = makeNode('sp1', 'sourcePreview', { outputPortConnected: true })
      const schema = makeNode('s1', 'schema', { columns: [] })
      const edge = makeEdge('e1', 'sp1', 's1')
      const { module, patches, edgesRef } = createTestContext([source, schema], [edge])

      module.syncOnDisconnect(edgesRef.value[0])

      expect(patches.find((p) => p.nodeId === 'sp1' && (p.data as Record<string, unknown>).outputPortConnected === false)).toBeDefined()
    })
  })

  describe('reconcileAll', () => {
    it('从 edges 重建所有关系状态', () => {
      const source = makeNode('sp1', 'sourcePreview', {})
      const schema = makeNode('s1', 'schema', { columns: [] })
      const constraint = makeNode('c1', 'notNullConstraint', {})
      const edges = [
        makeEdge('e1', 'sp1', 's1'),
        makeEdge('e2', 's1', 'c1'),
      ]
      const { module, nodesRef } = createTestContext([source, schema, constraint], edges)

      module.reconcileAll()

      const updatedSource = nodesRef.value.find((n) => n.id === 'sp1')
      const updatedSchema = nodesRef.value.find((n) => n.id === 's1')
      const updatedConstraint = nodesRef.value.find((n) => n.id === 'c1')

      expect((updatedSource?.data as Record<string, unknown>).outputPortConnected).toBe(true)
      expect((updatedSource?.data as Record<string, unknown>).children).toEqual(['s1'])
      expect((updatedSchema?.data as Record<string, unknown>).children).toEqual(['c1'])
      expect((updatedConstraint?.data as Record<string, unknown>).parent).toBe('s1')
    })

    it('schema 不被设置 parent（非 parent-capable 类型）', () => {
      const source = makeNode('sp1', 'sourcePreview', {})
      const schema = makeNode('s1', 'schema', { columns: [] })
      const edges = [makeEdge('e1', 'sp1', 's1')]
      const { module, nodesRef } = createTestContext([source, schema], edges)

      module.reconcileAll()

      const updatedSchema = nodesRef.value.find((n) => n.id === 's1')
      expect((updatedSchema?.data as Record<string, unknown>).parent).toBeUndefined()
    })

    it('清除孤立的关系字段', () => {
      const schema = makeNode('s1', 'schema', { columns: [], children: ['orphan'] })
      const { module, nodesRef } = createTestContext([schema], [])

      module.reconcileAll()

      const updated = nodesRef.value.find((n) => n.id === 's1')
      expect((updated?.data as Record<string, unknown>).children).toBeUndefined()
    })

    it('跳过瞬态边和 FK 展示边', () => {
      const schema = makeNode('s1', 'schema', { columns: [] })
      const constraint = makeNode('c1', 'notNullConstraint', {})
      const edges = [
        makeEdge('e1', 's1', 'c1', { transient: true }),
        makeEdge('e2', 's1', 'c1', { kind: 'fkDisplay' }),
      ]
      const { module, nodesRef } = createTestContext([schema, constraint], edges)

      module.reconcileAll()

      const updatedSchema = nodesRef.value.find((n) => n.id === 's1')
      expect((updatedSchema?.data as Record<string, unknown>).children).toBeUndefined()
    })

    it('幂等：多次调用结果一致', () => {
      const schema = makeNode('s1', 'schema', { columns: [] })
      const constraint = makeNode('c1', 'notNullConstraint', {})
      const edges = [makeEdge('e1', 's1', 'c1')]
      const { module, nodesRef } = createTestContext([schema, constraint], edges)

      module.reconcileAll()
      const first = JSON.stringify(nodesRef.value.map((n) => n.data))

      module.reconcileAll()
      const second = JSON.stringify(nodesRef.value.map((n) => n.data))

      expect(first).toBe(second)
    })
  })
})

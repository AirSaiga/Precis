import { describe, it, expect, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { CustomNode, CustomNodeData } from '@/types/graph'
import { createSchemaSourceIndex } from '@/stores/graphStore/modules/schemaSourceIndex'

function makeSchemaNode(id: string, overrides?: Partial<CustomNode>): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {
      configName: 'test',
      tableName: 'users',
      columns: [],
      saveState: 'draft',
      ...((overrides?.data as Record<string, unknown>) || {}),
    } as unknown as CustomNodeData,
    ...overrides,
  } as CustomNode
}

describe('createSchemaSourceIndex', () => {
  let nodes: Ref<CustomNode[]>
  let index: ReturnType<typeof createSchemaSourceIndex>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    index = createSchemaSourceIndex(nodes)
  })

  describe('findNodeIdBySource', () => {
    it('根据 sourceFilePath 查找节点', () => {
      nodes.value = [makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } })]
      expect(index.findNodeIdBySource('data/users.csv', null)).toBe('n1')
    })

    it('优先根据 localPath 查找节点', () => {
      nodes.value = [
        makeSchemaNode('n1', {
          data: { sourceFilePath: 'users.csv', localPath: 'data/users.csv' },
        }),
      ]
      expect(index.findNodeIdBySource('data/users.csv', null)).toBe('n1')
      expect(index.findNodeIdBySource('users.csv', null)).toBeUndefined()
    })

    it('区分不同 sheet', () => {
      nodes.value = [
        makeSchemaNode('n1', {
          data: { sourceFilePath: 'data.xlsx', sheetName: 'Sheet1' },
        }),
        makeSchemaNode('n2', {
          data: { sourceFilePath: 'data.xlsx', sheetName: 'Sheet2' },
        }),
      ]
      expect(index.findNodeIdBySource('data.xlsx', 'Sheet1')).toBe('n1')
      expect(index.findNodeIdBySource('data.xlsx', 'Sheet2')).toBe('n2')
    })
  })

  describe('isDuplicateSource', () => {
    it('单个节点不视为重复', () => {
      nodes.value = [makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } })]
      expect(index.isDuplicateSource('data/users.csv', null)).toBe(false)
    })

    it('两个节点使用同一 source 视为重复', () => {
      nodes.value = [
        makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } }),
        makeSchemaNode('n2', { data: { sourceFilePath: 'data/users.csv' } }),
      ]
      expect(index.isDuplicateSource('data/users.csv', null)).toBe(true)
    })

    it('excludeNodeId 可排除自身', () => {
      nodes.value = [
        makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } }),
        makeSchemaNode('n2', { data: { sourceFilePath: 'data/users.csv' } }),
      ]
      expect(index.isDuplicateSource('data/users.csv', null, 'n1')).toBe(true)
      expect(index.isDuplicateSource('data/users.csv', null, 'n2')).toBe(true)
    })

    it('排除后仅剩一个节点不视为重复', () => {
      nodes.value = [makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } })]
      expect(index.isDuplicateSource('data/users.csv', null, 'n1')).toBe(false)
    })

    it('localPath 优先于显示用的 sourceFilePath', () => {
      nodes.value = [
        makeSchemaNode('n1', {
          data: { sourceFilePath: 'users.csv', localPath: 'a/users.csv' },
        }),
        makeSchemaNode('n2', {
          data: { sourceFilePath: 'users.csv', localPath: 'b/users.csv' },
        }),
      ]
      expect(index.isDuplicateSource('users.csv', null)).toBe(false)
      expect(index.isDuplicateSource('a/users.csv', null)).toBe(false)
      expect(index.isDuplicateSource('b/users.csv', null)).toBe(false)
    })
  })

  describe('getConflictForSource', () => {
    it('返回不含 excludeNodeId 的冲突组', () => {
      nodes.value = [
        makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } }),
        makeSchemaNode('n2', { data: { sourceFilePath: 'data/users.csv' } }),
        makeSchemaNode('n3', { data: { sourceFilePath: 'data/users.csv' } }),
      ]
      const conflict = index.getConflictForSource('data/users.csv', null, 'n1')
      expect(conflict).not.toBeNull()
      expect(conflict!.nodeIds).toHaveLength(2)
      expect(conflict!.nodeIds).not.toContain('n1')
      expect(conflict!.nodeIds).toContain('n2')
      expect(conflict!.nodeIds).toContain('n3')
    })

    it('排除后不足两个节点返回 null', () => {
      nodes.value = [
        makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } }),
        makeSchemaNode('n2', { data: { sourceFilePath: 'data/users.csv' } }),
      ]
      expect(index.getConflictForSource('data/users.csv', null, 'n1')).toBeNull()
    })

    it('无冲突返回 null', () => {
      nodes.value = [makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } })]
      expect(index.getConflictForSource('data/users.csv', null)).toBeNull()
    })
  })

  describe('getConflicts', () => {
    it('返回所有冲突', () => {
      nodes.value = [
        makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } }),
        makeSchemaNode('n2', { data: { sourceFilePath: 'data/users.csv' } }),
        makeSchemaNode('n3', { data: { sourceFilePath: 'data/orders.csv' } }),
      ]
      const conflicts = index.getConflicts()
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].nodeIds).toEqual(['n1', 'n2'])
    })
  })

  describe('rebuild', () => {
    it('rebuild 后反映最新节点变化', () => {
      nodes.value = [makeSchemaNode('n1', { data: { sourceFilePath: 'data/users.csv' } })]
      expect(index.isDuplicateSource('data/users.csv', null)).toBe(false)
      nodes.value.push(makeSchemaNode('n2', { data: { sourceFilePath: 'data/users.csv' } }))
      index.rebuild()
      expect(index.isDuplicateSource('data/users.csv', null)).toBe(true)
    })
  })
})

/**
 * @fileoverview validationCollector 纯函数单元测试
 *
 * 测试 getSchemaNodeSourceInfo 的各种场景：
 * - Schema 节点自带路径信息
 * - 通过 SourcePreview 节点查找
 * - 无匹配时返回 null
 */

import { describe, it, expect } from 'vitest'
import { getSchemaNodeSourceInfo } from '@/services/constraints/orchestration/validationCollector'

function makeNodes() {
  return [
    {
      id: 'schema-1',
      type: 'schema',
      data: {
        tableName: 'users',
        sourceFilePath: '/data/users.csv',
        sourceFile: 'users.csv',
        sheetName: 'Sheet1',
        headerRow: 0,
        sourceMode: 'localfile',
        localPath: '/data/users.csv',
      },
    },
    {
      id: 'schema-2',
      type: 'schema',
      data: {
        tableName: 'orders',
        sourceNodeId: 'preview-2',
      },
    },
    {
      id: 'schema-3',
      type: 'schema',
      data: { tableName: 'empty' },
    },
    {
      id: 'schema-json',
      type: 'jsonSchema',
      data: {
        sourceFilePath: '/data/config.json',
        sourceFile: 'config.json',
      },
    },
    {
      id: 'preview-1',
      type: 'sourcePreview',
      data: {
        localPath: '/data/orders.csv',
        sourceName: 'orders.csv',
        currentSheet: 'Sheet1',
        headerRow: 0,
        sourceMode: 'localfile',
      },
    },
    {
      id: 'preview-2',
      type: 'sourcePreview',
      data: {
        localPath: '/data/roles.csv',
        sourceName: 'roles.csv',
      },
    },
    {
      id: 'other-node',
      type: 'transform',
      data: {},
    },
  ] as any[]
}

function makeEdges() {
  return [
    { source: 'preview-1', target: 'schema-2', targetHandle: 'target-left' },
    { source: 'other-node', target: 'schema-3', targetHandle: 'target-left' },
  ] as any[]
}

describe('validationCollector - getSchemaNodeSourceInfo', () => {
  describe('Schema 节点自带路径', () => {
    it('从 schema 节点的 sourceFilePath 获取信息', () => {
      const result = getSchemaNodeSourceInfo('schema-1', makeNodes(), [])
      expect(result).toBeTruthy()
      expect(result!.sourceFilePath).toBe('/data/users.csv')
      expect(result!.sourceFile).toBe('users.csv')
      expect(result!.sheetName).toBe('Sheet1')
      expect(result!.headerRow).toBe(0)
      expect(result!.sourceMode).toBe('localfile')
      expect(result!.localPath).toBe('/data/users.csv')
    })

    it('从 localPath 获取信息（无 sourceFilePath）', () => {
      const nodes = makeNodes()
      nodes[0].data.sourceFilePath = undefined
      const result = getSchemaNodeSourceInfo('schema-1', nodes, [])
      expect(result).toBeTruthy()
      expect(result!.sourceFilePath).toBe('/data/users.csv')
    })

    it('jsonSchema 类型也支持', () => {
      const result = getSchemaNodeSourceInfo('schema-json', makeNodes(), [])
      expect(result).toBeTruthy()
      expect(result!.sourceFilePath).toBe('/data/config.json')
    })
  })

  describe('通过 sourceNodeId 查找 SourcePreview', () => {
    it('schema 的 sourceNodeId 指向有效的 sourcePreview', () => {
      const result = getSchemaNodeSourceInfo('schema-2', makeNodes(), makeEdges())
      expect(result).toBeTruthy()
      expect(result!.sourceFilePath).toBe('/data/roles.csv')
      expect(result!.sourceNodeId).toBe('preview-2')
    })
  })

  describe('通过 edge 回退查找', () => {
    it('schema 无 sourceNodeId 时通过 incoming edge 查找', () => {
      const nodes = makeNodes()
      const schema2 = nodes.find((n) => n.id === 'schema-2')
      schema2.data.sourceNodeId = undefined
      const edges = [
        { source: 'preview-1', target: 'schema-2', targetHandle: 'target-left' },
      ] as any[]
      const result = getSchemaNodeSourceInfo('schema-2', nodes, edges)
      expect(result).toBeTruthy()
      expect(result!.sourceFilePath).toBe('/data/orders.csv')
    })

    it('incoming edge 无 targetHandle 时也能匹配', () => {
      const nodes = makeNodes()
      const schema2 = nodes.find((n) => n.id === 'schema-2')
      schema2.data.sourceNodeId = undefined
      const edges = [{ source: 'preview-1', target: 'schema-2' }] as any[]
      const result = getSchemaNodeSourceInfo('schema-2', nodes, edges)
      expect(result).toBeTruthy()
    })
  })

  describe('无匹配场景', () => {
    it('schema 不存在时返回 null', () => {
      const result = getSchemaNodeSourceInfo('nonexistent', makeNodes(), makeEdges())
      expect(result).toBeNull()
    })

    it('schema 无路径且无 incoming edge 返回 null', () => {
      const result = getSchemaNodeSourceInfo('schema-3', makeNodes(), makeEdges())
      expect(result).toBeNull()
    })

    it('incoming edge 的 source 非 sourcePreview 返回 null', () => {
      const result = getSchemaNodeSourceInfo('schema-3', makeNodes(), makeEdges())
      expect(result).toBeNull()
    })

    it('incoming edge 的 sourceNodeId 指向的节点不是 sourcePreview 返回 null', () => {
      const nodes = makeNodes()
      const schema2 = nodes.find((n) => n.id === 'schema-2')
      schema2.data.sourceNodeId = 'other-node'
      const result = getSchemaNodeSourceInfo('schema-2', nodes, [])
      expect(result).toBeNull()
    })
  })
})

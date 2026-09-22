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
/**
 * @fileoverview validationCollector 纯函数单元测试
 *
 * 测试 getSchemaNodeSourceInfo 的各种场景：
 * - 未连接数据源时缓存路径不作为校验依据（防幽灵 pass/fail）
 * - 通过 sourceNodeId 引用查找 SourcePreview
 * - 通过数据源入边查找（含多数据源优先级）
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
  describe('未连接数据源时缓存路径不作为校验依据', () => {
    it('Schema 缓存了 sourceFilePath 但无 sourceNodeId/入边 → 返回 null（防幽灵校验）', () => {
      const result = getSchemaNodeSourceInfo('schema-1', makeNodes(), [])
      expect(result).toBeNull()
    })

    it('Schema 仅缓存 localPath（无 sourceFilePath）同样返回 null', () => {
      const nodes = makeNodes()
      nodes[0].data.sourceFilePath = undefined
      const result = getSchemaNodeSourceInfo('schema-1', nodes, [])
      expect(result).toBeNull()
    })

    it('jsonSchema 类型缓存路径同样不作为校验依据', () => {
      const result = getSchemaNodeSourceInfo('schema-json', makeNodes(), [])
      expect(result).toBeNull()
    })

    it('连接 sourcePreview 后缓存场景恢复校验（sourceNodeId 引用）', () => {
      const nodes = makeNodes()
      const schema1 = nodes.find((n) => n.id === 'schema-1')
      schema1.data.sourceNodeId = 'preview-1'
      const result = getSchemaNodeSourceInfo('schema-1', nodes, [])
      expect(result).toBeTruthy()
      expect(result!.sourceFilePath).toBe('/data/orders.csv')
      expect(result!.sourceNodeId).toBe('preview-1')
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

    // Bug 2.1：sourceNodeId 指向的节点已删除/不存在时，即使 Schema 缓存了路径也应视为未连接
    it('sourceNodeId 指向已删除节点 + Schema 缓存路径 → 返回 null（Bug 2.1）', () => {
      const nodes = makeNodes()
      const schema2 = nodes.find((n) => n.id === 'schema-2')
      // 模拟：sourceNodeId 指向一个已不存在的节点，但 Schema 残留了路径缓存
      schema2.data.sourceNodeId = 'deleted-preview'
      schema2.data.sourceFilePath = '/data/stale.csv'
      schema2.data.localPath = '/data/stale.csv'
      const result = getSchemaNodeSourceInfo('schema-2', nodes, [])
      expect(result).toBeNull()
    })

    // 无 sourceNodeId + 缓存路径（V2 内联）→ 画布未连接，返回 null（防幽灵 pass/fail）
    it('无 sourceNodeId + 缓存路径（V2 内联）→ 返回 null（画布未连接不校验）', () => {
      const nodes = makeNodes()
      const schema1 = nodes.find((n) => n.id === 'schema-1')
      schema1.data.sourceNodeId = undefined
      const result = getSchemaNodeSourceInfo('schema-1', nodes, [])
      expect(result).toBeNull()
    })
  })

  describe('多数据源取边优先级（§2.3）', () => {
    function makeMultiSourceNodes() {
      return [
        {
          id: 'schema-m',
          type: 'schema',
          data: { tableName: 'mixed' },
        },
        {
          id: 'manual-1',
          type: 'manualData',
          data: { columns: [], rows: [] },
        },
        {
          id: 'preview-m',
          type: 'sourcePreview',
          data: {
            localPath: '/data/file-source.csv',
            sourceName: 'file-source.csv',
            headerRow: 0,
            sourceMode: 'localfile',
          },
        },
      ] as any[]
    }

    it('manualData 先连 + sourcePreview 后连 → 取 sourcePreview（不再取决于建边顺序）', () => {
      const nodes = makeMultiSourceNodes()
      const edges = [
        { source: 'manual-1', target: 'schema-m', targetHandle: 'target-left' },
        { source: 'preview-m', target: 'schema-m', targetHandle: 'target-left' },
      ] as any[]
      const result = getSchemaNodeSourceInfo('schema-m', nodes, edges)
      expect(result).toBeTruthy()
      expect(result!.sourceNodeId).toBe('preview-m')
      expect(result!.sourceFilePath).toBe('/data/file-source.csv')
    })

    it('sourcePreview 先连 + manualData 后连 → 仍取 sourcePreview', () => {
      const nodes = makeMultiSourceNodes()
      const edges = [
        { source: 'preview-m', target: 'schema-m', targetHandle: 'target-left' },
        { source: 'manual-1', target: 'schema-m', targetHandle: 'target-left' },
      ] as any[]
      const result = getSchemaNodeSourceInfo('schema-m', nodes, edges)
      expect(result).toBeTruthy()
      expect(result!.sourceNodeId).toBe('preview-m')
    })

    it('仅 manualData → 取 manualData（不再因第一条边类型不匹配而整表跳过）', () => {
      const nodes = makeMultiSourceNodes()
      const edges = [
        { source: 'manual-1', target: 'schema-m', targetHandle: 'target-left' },
      ] as any[]
      const result = getSchemaNodeSourceInfo('schema-m', nodes, edges)
      expect(result).toBeTruthy()
      expect(result!.sourceNodeId).toBe('manual-1')
    })
  })
})

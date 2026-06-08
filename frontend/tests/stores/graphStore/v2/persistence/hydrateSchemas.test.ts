import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/services/builders', () => ({
  fromBackendType: vi.fn((t: string) => {
    const map: Record<string, string> = {
      String: 'string',
      Integer: 'integer',
      Decimal: 'decimal',
      Boolean: 'boolean',
      DateTime: 'datetime',
      Date: 'date',
      Time: 'time',
    }
    return map[t] || t?.toLowerCase?.() || 'string'
  }),
}))

vi.mock('@/core/utils/pathNormalization', () => ({
  normalizePath: vi.fn((p: string) => p),
}))

vi.mock('@/stores/graphStore/modules/v2/shared/embeddedConstraints', () => ({
  materializeV2EmbeddedConstraints: vi.fn(),
}))

import { hydrateSchemasFromV2Config } from '@/stores/graphStore/modules/v2/persistence/load/hydrateSchemas'
import { materializeV2EmbeddedConstraints } from '@/stores/graphStore/modules/v2/shared/embeddedConstraints'

describe('hydrateSchemasFromV2Config', () => {
  const mockGetConfigPath = vi.fn(() => '/project')
  const mockResolveRelPath = vi.fn((dir?: string, rel?: string) => (dir && rel ? `${dir}/${rel}` : rel))

  beforeEach(() => {
    vi.mocked(materializeV2EmbeddedConstraints).mockClear()
  })

  it('空 schemas 列表返回空结果', () => {
    const config = { manifest: { schemas: [] }, schemas: {} }
    const result = hydrateSchemasFromV2Config({
      config,
      getEffectiveProjectConfigPath: mockGetConfigPath,
      resolveProjectRelativePath: mockResolveRelPath,
    })
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('创建 Schema 节点', () => {
    const config = {
      manifest: { schemas: [{ id: 's1' }] },
      schemas: {
        s1: {
          name: 'users',
          columns: [
            { id: 'col1', name: 'email', type: 'String' },
            { id: 'col2', name: 'age', type: 'Integer' },
          ],
          source: { path: 'data/users.xlsx', mode: 'relative_file', sheet: 'Sheet1' },
        },
      },
    }

    const result = hydrateSchemasFromV2Config({
      config,
      getEffectiveProjectConfigPath: mockGetConfigPath,
      resolveProjectRelativePath: mockResolveRelPath,
    })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('s1')
    expect(result.nodes[0].type).toBe('schema')
    expect((result.nodes[0].data as any).tableName).toBe('users')
    expect((result.nodes[0].data as any).sheetName).toBe('Sheet1')
    expect((result.nodes[0].data as any).columns).toHaveLength(2)
    expect((result.nodes[0].data as any).columns[0].columnName).toBe('email')
    expect((result.nodes[0].data as any).columns[0].dataType).toBe('string')
    expect((result.nodes[0].data as any).saveState).toBe('saved')
  })

  it('JSON schema 创建 jsonSchema 类型节点', () => {
    const config = {
      manifest: { schemas: [{ id: 's1' }] },
      schemas: {
        s1: {
          name: 'config',
          columns: [{ id: 'col1', name: 'key', type: 'String' }],
          source: { path: 'data/config.json', mode: 'relative_file' },
        },
      },
    }

    const result = hydrateSchemasFromV2Config({
      config,
      getEffectiveProjectConfigPath: mockGetConfigPath,
      resolveProjectRelativePath: mockResolveRelPath,
    })

    expect(result.nodes[0].type).toBe('jsonSchema')
  })

  it('缺失 schema 时跳过并 warn', () => {
    const config = {
      manifest: { schemas: [{ id: 'missing' }] },
      schemas: {},
    }

    const result = hydrateSchemasFromV2Config({
      config,
      getEffectiveProjectConfigPath: mockGetConfigPath,
      resolveProjectRelativePath: mockResolveRelPath,
    })

    expect(result.nodes).toHaveLength(0)
  })

  it('调用 materializeV2EmbeddedConstraints 处理内嵌约束', () => {
    const config = {
      manifest: { schemas: [{ id: 's1' }] },
      schemas: {
        s1: {
          name: 'users',
          columns: [{ id: 'col1', name: 'email', type: 'String' }],
          source: { path: 'data.xlsx', mode: 'relative_file' },
          constraints: [{ type: 'NotNull', column: 'email' }],
        },
      },
    }

    hydrateSchemasFromV2Config({
      config,
      getEffectiveProjectConfigPath: mockGetConfigPath,
      resolveProjectRelativePath: mockResolveRelPath,
    })

    expect(materializeV2EmbeddedConstraints).toHaveBeenCalledTimes(1)
  })

  it('absolute_file 模式直接使用路径', () => {
    const config = {
      manifest: { schemas: [{ id: 's1' }] },
      schemas: {
        s1: {
          name: 'users',
          columns: [],
          source: { path: '/abs/data.xlsx', mode: 'absolute_file' },
        },
      },
    }

    const result = hydrateSchemasFromV2Config({
      config,
      getEffectiveProjectConfigPath: mockGetConfigPath,
      resolveProjectRelativePath: mockResolveRelPath,
    })

    expect((result.nodes[0].data as any).localPath).toBe('/abs/data.xlsx')
  })

  it('节点位置按网格布局', () => {
    const config = {
      manifest: { schemas: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }] },
      schemas: {
        s1: { name: 'a', columns: [], source: { path: 'a.xlsx' } },
        s2: { name: 'b', columns: [], source: { path: 'b.xlsx' } },
        s3: { name: 'c', columns: [], source: { path: 'c.xlsx' } },
        s4: { name: 'd', columns: [], source: { path: 'd.xlsx' } },
      },
    }

    const result = hydrateSchemasFromV2Config({
      config,
      getEffectiveProjectConfigPath: mockGetConfigPath,
      resolveProjectRelativePath: mockResolveRelPath,
    })

    expect(result.nodes[0].position).toEqual({ x: 80, y: 80 })
    expect(result.nodes[1].position).toEqual({ x: 500, y: 80 })
    expect(result.nodes[2].position).toEqual({ x: 920, y: 80 })
    expect(result.nodes[3].position).toEqual({ x: 80, y: 400 })
  })
})

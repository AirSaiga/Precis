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
import { describe, it, expect, vi } from 'vitest'
import {
  NodePreviewFetcher,
  FilePreviewFetcher,
  CompositePreviewFetcher,
  type PreviewSource,
} from '@/utils/nodes/preview/PreviewDataFetcher'

vi.spyOn(console, 'error').mockImplementation(() => {})

const mockFetchPreviewDataFromPath = vi.fn()

vi.mock('@/services/preview/fetchPreviewFromPath', () => ({
  fetchPreviewDataFromPath: (...args: any[]) => mockFetchPreviewDataFromPath(...args),
}))

import { fetchPreviewDataFromPath } from '@/services/preview/fetchPreviewFromPath'

describe('NodePreviewFetcher', () => {
  const fetcher = new NodePreviewFetcher()

  it('非 node 类型返回 null', async () => {
    const result = await fetcher.fetch({ type: 'filePath', filePath: '/test.csv' })
    expect(result).toBeNull()
  })

  it('jsonSourcePreview 返回字段和数据', async () => {
    const source: PreviewSource = {
      type: 'node',
      node: {
        id: 'n1',
        type: 'jsonSourcePreview',
        data: {
          rawData: [{ name: 'Alice', age: 30 }],
          format: 'json',
          typeInference: { name: 'string' },
          fieldCount: 2,
          nestDepth: 1,
        },
      } as any,
    }
    const result = await fetcher.fetch(source)
    expect(result).not.toBeNull()
    expect(result?.rowCount).toBe(1)
    expect(result?.fields).toEqual(['name', 'age'])
    expect(result?.format).toBe('json')
    expect(result?.metadata?.fieldCount).toBe(2)
  })

  it('jsonSourcePreview 空数据返回零行', async () => {
    const source: PreviewSource = {
      type: 'node',
      node: {
        id: 'n1',
        type: 'jsonSourcePreview',
        data: { rawData: [] },
      } as any,
    }
    const result = await fetcher.fetch(source)
    expect(result).not.toBeNull()
    expect(result?.rowCount).toBe(0)
    expect(result?.fields).toBeUndefined()
  })

  it('sourcePreview 返回表头和数据', async () => {
    const source: PreviewSource = {
      type: 'node',
      node: {
        id: 'n1',
        type: 'sourcePreview',
        data: {
          data: [
            ['Name', 'Age'],
            ['Alice', '30'],
          ],
          format: 'csv',
          headerRow: 0,
        },
      } as any,
    }
    const result = await fetcher.fetch(source)
    expect(result).not.toBeNull()
    expect(result?.rowCount).toBe(2)
    expect(result?.fields).toEqual(['Name', 'Age'])
    expect(result?.format).toBe('csv')
  })

  it('sourcePreview 无数据返回 null', async () => {
    const source: PreviewSource = {
      type: 'node',
      node: {
        id: 'n1',
        type: 'sourcePreview',
        data: {},
      } as any,
    }
    const result = await fetcher.fetch(source)
    expect(result).toBeNull()
  })

  it('未知节点类型返回 null', async () => {
    const source: PreviewSource = {
      type: 'node',
      node: {
        id: 'n1',
        type: 'unknown',
        data: {},
      } as any,
    }
    const result = await fetcher.fetch(source)
    expect(result).toBeNull()
  })
})

describe('FilePreviewFetcher', () => {
  const fetcher = new FilePreviewFetcher()

  beforeEach(() => {
    mockFetchPreviewDataFromPath.mockClear()
  })

  it('非 filePath 类型返回 null', async () => {
    const result = await fetcher.fetch({ type: 'node', node: { id: 'n1' } as any })
    expect(result).toBeNull()
  })

  it('tabular 文件返回数据', async () => {
    mockFetchPreviewDataFromPath.mockResolvedValue({
      data: [
        ['Name', 'Age'],
        ['Alice', '30'],
      ],
      actualRowCount: 2,
      source_type: 'csv',
    })

    const source: PreviewSource = {
      type: 'filePath',
      filePath: '/data/test.csv',
      format: 'csv',
    }
    const result = await fetcher.fetch(source)
    expect(result).not.toBeNull()
    expect(result?.rowCount).toBe(2)
    expect(result?.fields).toEqual(['Name', 'Age'])
    expect(result?.format).toBe('csv')
  })

  it('JSON 文件返回数据', async () => {
    mockFetchPreviewDataFromPath.mockResolvedValue({
      raw_data: [{ name: 'Alice', age: 30 }],
      type_inference: { name: 'string', age: 'number' },
      field_count: 2,
      nest_depth: 1,
      source_type: 'json',
    })

    const source: PreviewSource = {
      type: 'filePath',
      filePath: '/data/test.json',
      format: 'json',
    }
    const result = await fetcher.fetch(source)
    expect(result).not.toBeNull()
    expect(result?.rowCount).toBe(1)
    expect(result?.fields).toEqual(['name', 'age'])
    expect(result?.format).toBe('json')
    expect(result?.metadata?.fieldCount).toBe(2)
  })

  it('JSON 无数据返回零行', async () => {
    mockFetchPreviewDataFromPath.mockResolvedValue({
      raw_data: [],
      source_type: 'json',
    })

    const result = await fetcher.fetch({
      type: 'filePath',
      filePath: '/data/test.json',
      format: 'json',
    })
    expect(result).not.toBeNull()
    expect(result?.rowCount).toBe(0)
    expect(result?.fields).toBeUndefined()
  })

  it('API 错误返回 null', async () => {
    mockFetchPreviewDataFromPath.mockRejectedValue(new Error('network'))
    const result = await fetcher.fetch({ type: 'filePath', filePath: '/data/test.csv' })
    expect(result).toBeNull()
  })

  it('空结果返回 null', async () => {
    mockFetchPreviewDataFromPath.mockResolvedValue(null)
    const result = await fetcher.fetch({ type: 'filePath', filePath: '/data/test.csv' })
    expect(result).toBeNull()
  })
})

describe('CompositePreviewFetcher', () => {
  const fetcher = new CompositePreviewFetcher()

  beforeEach(() => {
    mockFetchPreviewDataFromPath.mockClear()
  })

  it('node 类型优先从节点获取', async () => {
    const source: PreviewSource = {
      type: 'node',
      node: {
        id: 'n1',
        type: 'sourcePreview',
        data: {
          data: [['A', 'B']],
          format: 'csv',
          headerRow: 0,
        },
      } as any,
    }
    const result = await fetcher.fetch(source)
    expect(result).not.toBeNull()
    expect(result?.fields).toEqual(['A', 'B'])
  })

  it('node 无数据时回退到文件路径', async () => {
    mockFetchPreviewDataFromPath.mockResolvedValue({
      data: [['X', 'Y']],
      actualRowCount: 1,
      source_type: 'csv',
    })

    const source: PreviewSource = {
      type: 'node',
      node: {
        id: 'n1',
        type: 'sourcePreview',
        data: {
          localPath: '/data/file.csv',
          format: 'csv',
        },
      } as any,
    }
    const result = await fetcher.fetch(source)
    expect(result).not.toBeNull()
    expect(result?.fields).toEqual(['X', 'Y'])
  })

  it('jsonSourcePreview 回退携带 jsonOptions', async () => {
    mockFetchPreviewDataFromPath.mockResolvedValue({
      raw_data: [{ a: 1 }],
      source_type: 'json',
    })

    const source: PreviewSource = {
      type: 'node',
      node: {
        id: 'n1',
        type: 'jsonSourcePreview',
        data: {
          localPath: '/data/file.json',
          format: 'json',
          jsonPath: '$.items',
          recordPath: '$.records',
        },
      } as any,
    }
    const result = await fetcher.fetch(source)
    expect(result).not.toBeNull()
    expect(mockFetchPreviewDataFromPath).toHaveBeenCalledWith(
      '/data/file.json',
      65535,
      65535,
      undefined,
      expect.objectContaining({ jsonPath: '$.items', recordPath: '$.records' })
    )
  })

  it('filePath 类型直接委托 FilePreviewFetcher', async () => {
    mockFetchPreviewDataFromPath.mockResolvedValue({
      data: [['A']],
      actualRowCount: 1,
      source_type: 'csv',
    })

    const result = await fetcher.fetch({ type: 'filePath', filePath: '/data/test.csv' })
    expect(result).not.toBeNull()
    expect(result?.fields).toEqual(['A'])
  })

  it('未知类型返回 null', async () => {
    const result = await fetcher.fetch({ type: 'unknown' } as any)
    expect(result).toBeNull()
  })
})

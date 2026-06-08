import { describe, it, expect, vi } from 'vitest'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { hydrateTransformNodesFromV2Config } from '@/stores/graphStore/modules/v2/persistence/load/hydrateTransforms'

describe('hydrateTransformNodesFromV2Config', () => {
  it('空 transforms 列表返回空结果', () => {
    const config = { manifest: { transforms: [] }, transforms: {} }
    const result = hydrateTransformNodesFromV2Config({ config, existingNodes: [] })
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('创建 Transform 节点', () => {
    const config = {
      manifest: { transforms: [{ id: 't1' }] },
      transforms: {
        t1: {
          name: 'SplitName',
          type: 'StringSplit',
          description: 'split full name',
          input_from_node: 's1',
          input_column: 'col1',
          params: { delimiter: ' ' },
          output_columns: ['first_name', 'last_name'],
          enabled: true,
        },
      },
    }

    const result = hydrateTransformNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe('t1')
    expect(result.nodes[0].type).toBe('transform')
    expect((result.nodes[0].data as any).configName).toBe('SplitName')
    expect((result.nodes[0].data as any).transformType).toBe('StringSplit')
    expect((result.nodes[0].data as any).description).toBe('split full name')
    expect((result.nodes[0].data as any).inputFromNode).toBe('s1')
    expect((result.nodes[0].data as any).inputColumn).toBe('col1')
    expect((result.nodes[0].data as any).params).toEqual({ delimiter: ' ' })
    expect((result.nodes[0].data as any).outputColumns).toEqual(['first_name', 'last_name'])
    expect((result.nodes[0].data as any).enabled).toBe(true)
    expect((result.nodes[0].data as any).saveState).toBe('saved')
  })

  it('默认 transformType 为 StringSplit', () => {
    const config = {
      manifest: { transforms: [{ id: 't1' }] },
      transforms: {
        t1: { name: 'T1' },
      },
    }

    const result = hydrateTransformNodesFromV2Config({ config, existingNodes: [] })

    expect((result.nodes[0].data as any).transformType).toBe('StringSplit')
  })

  it('缺失 transform 时跳过', () => {
    const config = {
      manifest: { transforms: [{ id: 'missing' }] },
      transforms: {},
    }

    const result = hydrateTransformNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(0)
  })

  it('有 inputFromNode 时创建数据流边', () => {
    const config = {
      manifest: { transforms: [{ id: 't1' }] },
      transforms: {
        t1: {
          name: 'T1',
          input_from_node: 's1',
          input_column: 'col1',
        },
      },
    }
    const existingNodes: CustomNode[] = [
      {
        id: 's1',
        type: 'schema',
        position: { x: 0, y: 0 },
        data: { tableName: 'users' } as CustomNodeData,
      } as CustomNode,
    ]

    const result = hydrateTransformNodesFromV2Config({ config, existingNodes })

    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].source).toBe('s1')
    expect(result.edges[0].target).toBe('t1')
    expect(result.edges[0].animated).toBe(true)
  })

  it('transform 源使用 transform-output handle', () => {
    const config = {
      manifest: { transforms: [{ id: 't2' }] },
      transforms: {
        t2: {
          name: 'T2',
          input_from_node: 't1',
        },
      },
    }
    const existingNodes: CustomNode[] = [
      {
        id: 't1',
        type: 'transform',
        position: { x: 0, y: 0 },
        data: {} as CustomNodeData,
      } as CustomNode,
    ]

    const result = hydrateTransformNodesFromV2Config({ config, existingNodes })

    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].sourceHandle).toBe('transform-output')
  })

  it('regex 源使用 regex-output handle', () => {
    const config = {
      manifest: { transforms: [{ id: 't1' }] },
      transforms: {
        t1: {
          name: 'T1',
          input_from_node: 'r1',
        },
      },
    }
    const existingNodes: CustomNode[] = [
      {
        id: 'r1',
        type: 'regex',
        position: { x: 0, y: 0 },
        data: {} as CustomNodeData,
      } as CustomNode,
    ]

    const result = hydrateTransformNodesFromV2Config({ config, existingNodes })

    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].sourceHandle).toBe('regex-output')
  })

  it('源节点不存在时不创建边', () => {
    const config = {
      manifest: { transforms: [{ id: 't1' }] },
      transforms: {
        t1: { name: 'T1', input_from_node: 'nonexistent' },
      },
    }

    const result = hydrateTransformNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(0)
  })

  it('网格布局位置', () => {
    const config = {
      manifest: { transforms: [{ id: 't1' }, { id: 't2' }] },
      transforms: {
        t1: { name: 'A' },
        t2: { name: 'B' },
      },
    }

    const result = hydrateTransformNodesFromV2Config({ config, existingNodes: [] })

    expect(result.nodes[0].position).toEqual({ x: 980, y: 80 })
    expect(result.nodes[1].position).toEqual({ x: 1400, y: 80 })
  })
})

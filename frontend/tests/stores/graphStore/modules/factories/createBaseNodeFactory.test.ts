/**
 * @fileoverview createBaseNodeFactory 单元测试
 *
 * 重点回归（选择模型一致性）：autoSelect 创建节点时必须收敛选中状态——
 * 清除旧节点的 selected 标志、新节点带 selected 入图。
 * 此前只写 selectedNodeId 不动 Vue Flow 选中集，导致
 * "框选 A/B/C 后新建 D，Delete/Ctrl+C 仍作用于 A/B/C"。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode } from '@/types/graph'
import { createBaseNodeFactory } from '@/stores/graphStore/modules/factories/createBaseNodeFactory'
import { addNodes, findNode } from '@/services/canvas/vueFlowApi'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addNodes: vi.fn(),
  findNode: vi.fn(() => undefined),
}))

vi.mock('@/services/canvas/animationDurations', () => ({
  NODE_ENTER_DURATION_MS: 0,
  NODE_ENTERING_CLASS: 'node-entering',
}))

function makeSelectedNode(id: string): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: {},
    selected: true,
  } as unknown as CustomNode
}

describe('createBaseNodeFactory 选择模型一致性', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findNode).mockReturnValue(undefined)
  })

  it('autoSelect 时新节点带 selected 入图，且清除旧节点的选中标志', () => {
    const nodes = ref<CustomNode[]>([makeSelectedNode('a'), makeSelectedNode('b')])
    const vfNodes = new Map<string, { selected: boolean }>([
      ['a', { selected: true }],
      ['b', { selected: true }],
    ])
    // findNode 返回 Vue Flow 内部 GraphNode（可增量修改 selected）
    vi.mocked(findNode).mockImplementation(((id: string) => vfNodes.get(id)) as never)

    const selectedNodeId = ref<string | null>('a')
    const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

    const newId = createNode('schema', { x: 10, y: 10 }, {})

    // 新节点带 selected 入图
    expect(addNodes).toHaveBeenCalledTimes(1)
    const added = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
    expect(Array.isArray(added) ? added[0].selected : added.selected).toBe(true)

    // 旧节点（store ref 与 VF 内部）选中标志被清除
    expect(nodes.value.find((n) => n.id === 'a')?.selected).toBe(false)
    expect(nodes.value.find((n) => n.id === 'b')?.selected).toBe(false)
    expect(vfNodes.get('a')?.selected).toBe(false)
    expect(vfNodes.get('b')?.selected).toBe(false)

    // 单选焦点切换到新节点
    expect(selectedNodeId.value).toBe(newId)
  })

  it('autoSelect: false 时不改变任何选中状态', () => {
    const nodes = ref<CustomNode[]>([makeSelectedNode('a')])
    const selectedNodeId = ref<string | null>('a')
    const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

    createNode('schema', { x: 10, y: 10 }, {}, { autoSelect: false })

    const added = vi.mocked(addNodes).mock.calls[0][0] as CustomNode
    expect(Array.isArray(added) ? added[0].selected : added.selected).toBeUndefined()
    expect(nodes.value.find((n) => n.id === 'a')?.selected).toBe(true)
    expect(selectedNodeId.value).toBe('a')
  })

  it('Vue Flow 未初始化（findNode 返回 undefined）时不抛错，仍清 store ref 上的标志', () => {
    const nodes = ref<CustomNode[]>([makeSelectedNode('a')])
    const selectedNodeId = ref<string | null | undefined>(null)
    const createNode = createBaseNodeFactory({ nodes, selectedNodeId })

    expect(() => createNode('schema', { x: 0, y: 0 }, {})).not.toThrow()
    expect(nodes.value.find((n) => n.id === 'a')?.selected).toBe(false)
  })
})

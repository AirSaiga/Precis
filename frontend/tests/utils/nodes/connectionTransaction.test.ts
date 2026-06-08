import { describe, it, expect, vi } from 'vitest'
import { createConnectionTransaction } from '@/utils/nodes/connectionTransaction'
import type { CustomNode } from '@/types/graph'

function makeNode(overrides?: Partial<CustomNode>): CustomNode {
  return {
    id: 'node-1',
    type: 'schema',
    position: { x: 0, y: 0 },
    data: { configName: 'Test' } as any,
    ...overrides,
  } as CustomNode
}

describe('createConnectionTransaction', () => {
  describe('patchNodeData', () => {
    it('应用 patch 到节点的 data', () => {
      const updateNodeData = vi.fn()
      const node = makeNode({ id: 'n1', data: { configName: 'Old', sourceRef: {} } as any })
      const tx = createConnectionTransaction({ nodes: [node], updateNodeData })

      tx.patchNodeData('n1', { configName: 'New' } as any)

      expect(updateNodeData).toHaveBeenCalledTimes(1)
      expect(updateNodeData).toHaveBeenCalledWith('n1', { configName: 'New' })
    })

    it('多次 patch 同一节点', () => {
      const updateNodeData = vi.fn()
      const node = makeNode({ id: 'n1', data: { configName: 'Old', sourceRef: {} } as any })
      const tx = createConnectionTransaction({ nodes: [node], updateNodeData })

      tx.patchNodeData('n1', { configName: 'A' } as any)
      tx.patchNodeData('n1', { configName: 'B' } as any)

      expect(updateNodeData).toHaveBeenCalledTimes(2)
      expect(updateNodeData).toHaveBeenNthCalledWith(1, 'n1', { configName: 'A' })
      expect(updateNodeData).toHaveBeenNthCalledWith(2, 'n1', { configName: 'B' })
    })

    it('patch 不存在的节点不做任何事', () => {
      const updateNodeData = vi.fn()
      const node = makeNode({ id: 'n1' })
      const tx = createConnectionTransaction({ nodes: [node], updateNodeData })

      tx.patchNodeData('nonexistent', { configName: 'X' } as any)

      expect(updateNodeData).not.toHaveBeenCalled()
    })
  })

  describe('commit', () => {
    it('commit 后 rollback 无效', () => {
      const updateNodeData = vi.fn()
      const node = makeNode({ id: 'n1', data: { configName: 'Old' } as any })
      const tx = createConnectionTransaction({ nodes: [node], updateNodeData })

      tx.patchNodeData('n1', { configName: 'New' } as any)
      updateNodeData.mockClear()

      tx.commit()
      tx.rollback()

      expect(updateNodeData).not.toHaveBeenCalled()
    })
  })

  describe('rollback', () => {
    it('回滚恢复到 patch 前的状态', () => {
      const updateNodeData = vi.fn()
      const node = makeNode({ id: 'n1', data: { configName: 'Old', sourceRef: { columnId: 'c1' } } as any })
      const tx = createConnectionTransaction({ nodes: [node], updateNodeData })

      tx.patchNodeData('n1', { configName: 'New' } as any)
      updateNodeData.mockClear()

      tx.rollback()

      expect(updateNodeData).toHaveBeenCalledTimes(1)
      expect(updateNodeData).toHaveBeenCalledWith('n1', { configName: 'Old' })
    })

    it('回滚多个 patch', () => {
      const updateNodeData = vi.fn()
      const node = makeNode({
        id: 'n1',
        data: { configName: 'Old', sourceRef: { columnId: 'c1' }, saveState: 'saved' } as any,
      })
      const tx = createConnectionTransaction({ nodes: [node], updateNodeData })

      tx.patchNodeData('n1', { configName: 'A', saveState: 'draft' } as any)
      tx.patchNodeData('n1', { sourceRef: { columnId: 'c2' } } as any)
      updateNodeData.mockClear()

      tx.rollback()

      expect(updateNodeData).toHaveBeenCalledTimes(2)
    })

    it('回滚后节点在快照时已删除，回退函数不崩溃', () => {
      const updateNodeData = vi.fn()
      const node = makeNode({ id: 'n1', data: { configName: 'Old' } as any })
      const nodes = [node]
      const tx = createConnectionTransaction({ nodes, updateNodeData })

      tx.patchNodeData('n1', { configName: 'New' } as any)
      nodes.length = 0
      updateNodeData.mockClear()

      expect(() => tx.rollback()).not.toThrow()
    })
  })
})

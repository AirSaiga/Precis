/**
 * @fileoverview history 模块单元测试
 *
 * 测试 saveState / undo / redo 操作
 *
 * 使用 shallowRef 避免 Vue 深层响应式代理导致 structuredClone 失败
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { createHistoryModule } from '@/stores/graphStore/modules/history'
import type { CustomNode, CustomNodeData } from '@/types/graph'

function makeNode(id: string, label: string): CustomNode {
  return { id, type: 'schema', position: { x: 0, y: 0 }, data: { configName: label } as CustomNodeData } as CustomNode
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge
}

describe('history module', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let reconcileCalls: number
  let module: ReturnType<typeof createHistoryModule>

  beforeEach(() => {
    nodes = ref<CustomNode[]>([makeNode('n1', 'A')])
    edges = ref<Edge[]>([])
    reconcileCalls = 0
    module = createHistoryModule({
      nodes,
      edges,
      maxHistoryLength: 5,
      reconcileAll: () => {
        reconcileCalls++
      },
    })
  })

  describe('saveState', () => {
    it('保存快照到 undoStack', () => {
      module.saveState()
      expect(module.undoStack.value).toHaveLength(1)
      expect(module.undoStack.value[0].nodes[0].data.configName).toBe('A')
    })

    it('清空 redoStack', async () => {
      module.saveState()
      nodes.value = [makeNode('n1', 'B')]

      await module.undo()
      expect(module.redoStack.value).toHaveLength(1)

      module.saveState()
      expect(module.redoStack.value).toHaveLength(0)
    })

    it('超出 maxLength 时丢弃最旧快照', () => {
      for (let i = 0; i < 6; i++) {
        module.saveState()
        nodes.value = [makeNode('n1', `v${i}`)]
      }
      expect(module.undoStack.value).toHaveLength(5)
    })
  })

  describe('undo', () => {
    it('恢复到上一个状态', async () => {
      module.saveState()
      nodes.value = [makeNode('n1', 'B')]

      await module.undo()

      expect(nodes.value[0].data.configName).toBe('A')
    })

    it('将当前状态推入 redoStack', async () => {
      module.saveState()
      nodes.value = [makeNode('n1', 'B')]

      await module.undo()

      expect(module.redoStack.value).toHaveLength(1)
      expect(module.redoStack.value[0].nodes[0].data.configName).toBe('B')
    })

    it('undo 后调用 reconcileAll', async () => {
      module.saveState()
      nodes.value = [makeNode('n1', 'B')]

      await module.undo()

      expect(reconcileCalls).toBe(1)
    })

    it('空栈时不操作', async () => {
      await module.undo()
      expect(nodes.value[0].data.configName).toBe('A')
    })
  })

  describe('redo', () => {
    it('恢复被撤销的状态', async () => {
      module.saveState()
      nodes.value = [makeNode('n1', 'B')]
      await module.undo()

      await module.redo()

      expect(nodes.value[0].data.configName).toBe('B')
    })

    it('redo 后调用 reconcileAll', async () => {
      module.saveState()
      nodes.value = [makeNode('n1', 'B')]
      await module.undo()

      await module.redo()

      expect(reconcileCalls).toBe(2)
    })

    it('空栈时不操作', async () => {
      await module.redo()
      expect(nodes.value[0].data.configName).toBe('A')
    })
  })

  describe('undo → redo 往返', () => {
    it('完整往返后状态恢复', async () => {
      module.saveState()
      const original = JSON.stringify(nodes.value.map((n) => n.data))

      nodes.value = [makeNode('n1', 'CHANGED')]

      await module.undo()
      expect(nodes.value[0].data.configName).toBe('A')

      await module.redo()
      expect(nodes.value[0].data.configName).toBe('CHANGED')

      const after = JSON.stringify(nodes.value.map((n) => n.data))
      expect(after).not.toBe(original)
    })
  })
})

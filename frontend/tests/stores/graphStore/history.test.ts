/**
 * @fileoverview history 模块单元测试
 *
 * 测试 saveState / undo / redo 操作
 *
 * 使用 shallowRef 避免 Vue 深层响应式代理导致 structuredClone 失败
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, reactive, toRaw, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import { createHistoryModule } from '@/stores/graphStore/modules/history'
import type { CustomNode, CustomNodeData } from '@/types/graph'

function makeNode(id: string, label: string): CustomNode {
  return {
    id,
    type: 'schema',
    position: { x: 0, y: 0 },
    data: { configName: label } as CustomNodeData,
  } as CustomNode
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

  describe('snapshot isolation', () => {
    // 回归守护：验证 redoStack 快照与活跃 nodes 相互隔离
    // （undo 当前态经 cloneCurrent 深拷贝入 redoStack，而非直接引用）
    it('undo 后修改当前节点 data 不会污染 redoStack 快照', async () => {
      const n1 = makeNode('n1', 'A')
      nodes.value = [n1]
      module.saveState()
      nodes.value = [{ ...n1, data: { configName: 'B' } as CustomNodeData } as CustomNode]

      await module.undo()

      const current = nodes.value[0]
      ;(current.data as { configName: string }).configName = 'MUTATED'

      const redoSnapshot = module.redoStack.value[0]
      expect(redoSnapshot.nodes[0].data.configName).toBe('B')
    })

    it('undo 恢复的节点是历史快照的深拷贝,非同一引用', async () => {
      const v0 = makeNode('n1', 'A')
      nodes.value = [v0]
      module.saveState()
      nodes.value = [makeNode('n1', 'B')]

      const snapshotBefore = module.undoStack.value[0]
      await module.undo()

      // ref<CustomNode[]> 会对元素施加深层响应式代理，nodes.value[0] 永远是 proxy，
      // 直接做 !== 会恒为真而无法暴露是否深克隆。因此用 toRaw 剥离代理后再比较底层引用：
      // 若 undo 做了 structuredClone，toRaw(nodes.value[0]) 与快照中的节点应是不同对象。
      expect(toRaw(nodes.value[0])).not.toBe(snapshotBefore.nodes[0])
      expect(toRaw(toRaw(nodes.value[0]).data)).not.toBe(snapshotBefore.nodes[0].data)
    })

    it('支持 reactive 嵌套 proxy 的深克隆（不抛 DataCloneError）', () => {
      // 模拟 Vue Flow 富化后的真实情况：node.data 本身成为深层 reactive proxy。
      // 仅用 reactive() 包裹外层数组不会让既有的 plain data 对象变成 proxy，
      // 因此必须单独对 data 调用 reactive() 才能复现 DataCloneError。
      const reactiveData = reactive({ configName: 'R' }) as CustomNodeData
      const reactiveNode = {
        id: 'rn1',
        type: 'schema',
        position: { x: 0, y: 0 },
        data: reactiveData,
      } as unknown as CustomNode
      nodes.value = [reactiveNode]

      expect(() => module.saveState()).not.toThrow()
      expect(module.undoStack.value[0].nodes[0].data.configName).toBe('R')
    })
  })
})

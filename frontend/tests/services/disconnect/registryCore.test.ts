import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { Edge, Node } from '@vue-flow/core'
import type { Ref } from 'vue'
import { ref } from 'vue'

let executeDisconnectCleanupModule: any
let registerDisconnectHandlerModule: any

describe('disconnect registryCore', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.doMock('@/services/constraints/validationRegistry', () => ({
      isConstraintNodeType: vi.fn((type: string) =>
        ['notNullConstraint', 'uniqueConstraint', 'foreignKeyConstraint', 'allowedValuesConstraint',
         'rangeConstraint', 'conditionalConstraint', 'scriptedConstraint', 'charsetConstraint',
         'dateLogicConstraint', 'compositeConstraint'].includes(type)
      ),
      buildDisconnectReset: vi.fn(() => ({ validationStatus: 'idle', validationErrors: [] })),
    }))

    const mod = await import('@/services/disconnect/registryCore')
    executeDisconnectCleanupModule = mod.executeDisconnectCleanup
    registerDisconnectHandlerModule = mod.registerDisconnectHandler
  })

  describe('executeDisconnectCleanup', () => {
    function makeEdge(overrides?: Partial<Edge>): Edge {
      return {
        id: 'e1',
        source: 's1',
        target: 't1',
        ...overrides,
      }
    }

    function makeNode(overrides?: Partial<Node>): Node {
      return {
        id: 'n1',
        type: 'schema',
        position: { x: 0, y: 0 },
        data: {},
        ...overrides,
      } as Node
    }

    function makeContext(overrides?: Partial<{
      nodes: any[]
      edges: any[]
      updateNodeData: any
      syncOnDisconnect: any
      clearAllValidationErrors: any
    }>) {
      const n = ref(overrides?.nodes ?? []) as Ref<any[]>
      const e = ref(overrides?.edges ?? []) as Ref<Edge[]>
      return {
        nodes: n,
        edges: e,
        updateNodeData: overrides?.updateNodeData ?? vi.fn(),
        syncOnDisconnect: overrides?.syncOnDisconnect ?? vi.fn(),
        clearAllValidationErrors: overrides?.clearAllValidationErrors ?? vi.fn(),
      }
    }

    it('targetNode 不存在时直接返回', () => {
      const edge = makeEdge()
      const sourceNode = makeNode()
      const ctx = makeContext()
      const cleanupSpy = vi.fn()

      registerDisconnectHandlerModule({
        priority: 100,
        match: vi.fn().mockReturnValue(true),
        cleanup: cleanupSpy,
      })

      executeDisconnectCleanupModule(edge, sourceNode, undefined, ctx)

      expect(cleanupSpy).not.toHaveBeenCalled()
    })

    it('匹配到 handler 时执行 cleanup', () => {
      const edge = makeEdge()
      const sourceNode = makeNode()
      const targetNode = makeNode()
      const ctx = makeContext()
      const cleanupSpy = vi.fn()

      registerDisconnectHandlerModule({
        priority: 100,
        match: vi.fn().mockReturnValue(true),
        cleanup: cleanupSpy,
      })

      executeDisconnectCleanupModule(edge, sourceNode, targetNode, ctx)

      expect(cleanupSpy).toHaveBeenCalledWith(edge, sourceNode, targetNode, ctx)
    })

    it('无匹配 handler 时不执行任何清理', () => {
      const edge = makeEdge()
      const sourceNode = makeNode()
      const targetNode = makeNode()
      const ctx = makeContext()
      const cleanupSpy = vi.fn()

      registerDisconnectHandlerModule({
        priority: 100,
        match: vi.fn().mockReturnValue(false),
        cleanup: cleanupSpy,
      })

      executeDisconnectCleanupModule(edge, sourceNode, targetNode, ctx)

      expect(cleanupSpy).not.toHaveBeenCalled()
    })

    it('多个 handler 按优先级匹配第一个', () => {
      const edge = makeEdge()
      const sourceNode = makeNode()
      const targetNode = makeNode()
      const ctx = makeContext()
      const lowPriorityCleanup = vi.fn()
      const highPriorityCleanup = vi.fn()

      registerDisconnectHandlerModule({
        priority: 10,
        match: vi.fn().mockReturnValue(true),
        cleanup: highPriorityCleanup,
      })
      registerDisconnectHandlerModule({
        priority: 100,
        match: vi.fn().mockReturnValue(true),
        cleanup: lowPriorityCleanup,
      })

      executeDisconnectCleanupModule(edge, sourceNode, targetNode, ctx)

      expect(highPriorityCleanup).toHaveBeenCalledTimes(1)
      expect(lowPriorityCleanup).not.toHaveBeenCalled()
    })

    it('多个 handler 高优先级不匹配时退到低优先级', () => {
      const edge = makeEdge()
      const sourceNode = makeNode()
      const targetNode = makeNode()
      const ctx = makeContext()
      const highPriorityCleanup = vi.fn()
      const lowPriorityCleanup = vi.fn()

      registerDisconnectHandlerModule({
        priority: 10,
        match: vi.fn().mockReturnValue(false),
        cleanup: highPriorityCleanup,
      })
      registerDisconnectHandlerModule({
        priority: 50,
        match: vi.fn().mockReturnValue(true),
        cleanup: lowPriorityCleanup,
      })

      executeDisconnectCleanupModule(edge, sourceNode, targetNode, ctx)

      expect(highPriorityCleanup).not.toHaveBeenCalled()
      expect(lowPriorityCleanup).toHaveBeenCalledTimes(1)
    })
  })
})

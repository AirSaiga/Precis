/**
 * X04 — graphStore 连接模块 batchAddEdges 行为校验
 *
 * 本测试由 verify.mjs 复制进 frontend/tests/stores/graphStore/ 后以 vitest 运行。
 *
 * 关键设计：vueFlowApi 边界 mock 的 addEdges 会**模拟 Vue Flow 的真实写回行为**
 * （边经原生 API 提交后，通过 v-model 同步回 store 的 edges ref）。
 * 因此「经 addEdges 批量提交」与「绕过 API 直接 push 边数组」在断言上可区分：
 * 后者不会触发本 mock，Vue Flow 内部状态（以本 mock 为代表）将永远丢失这些边。
 *
 * Mock 面（仅外部边界，遵循仓库测试规范）：
 *   - @/services/canvas/vueFlowApi — Vue Flow 原生 API 注入层（外部边界）
 *   - @/services/disconnect        — 断开清理服务（batchAddEdges 路径不经过，仅隔离模块加载）
 *   - @/core/utils/logger          — 静默日志
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'
import type { Edge } from '@vue-flow/core'
import type { CustomNode, CustomNodeData } from '@/types/graph'

vi.mock('@/services/canvas/vueFlowApi', () => ({
  addEdges: vi.fn(),
  removeEdges: vi.fn(),
  findEdge: vi.fn(() => undefined),
}))

vi.mock('@/services/disconnect', () => ({
  executeDisconnectCleanup: vi.fn(),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { addEdges } from '@/services/canvas/vueFlowApi'
import { createConnectionOpsModule } from '@/stores/graphStore/modules/connectionOps'

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge
}

/** 收集 addEdges 全部被调用中提交过的边 id（一次数组调用或多次单条调用均可） */
function collectedEdgeIds(): string[] {
  return vi
    .mocked(addEdges)
    .mock.calls.flatMap((call) => {
      const arg = call[0] as Edge | Edge[]
      return Array.isArray(arg) ? arg.map((e) => e.id) : [arg.id]
    })
}

/** 契约类型：实现就位前模块上没有 batchAddEdges，用可选字段探测 */
type ConnectionOpsWithBatch = ReturnType<typeof createConnectionOpsModule> & {
  batchAddEdges?: (newEdges: Edge[]) => void
}

describe('X04 — connectionOps.batchAddEdges 批量加边', () => {
  let nodes: Ref<CustomNode[]>
  let edges: Ref<Edge[]>
  let module: ConnectionOpsWithBatch
  const mockUpdateNodeData = vi.fn()
  const mockClearValidation = vi.fn()
  const mockSyncOnDisconnect = vi.fn()
  const mockReconcileAll = vi.fn()

  beforeEach(() => {
    nodes = ref<CustomNode[]>([])
    edges = ref<Edge[]>([])
    module = createConnectionOpsModule({
      nodes,
      edges,
      updateNodeData: mockUpdateNodeData,
      clearAllValidationErrors: mockClearValidation,
      syncOnDisconnect: mockSyncOnDisconnect,
      reconcileAll: mockReconcileAll,
    }) as ConnectionOpsWithBatch

    vi.mocked(addEdges).mockReset()
    // 模拟 Vue Flow 真实行为：addEdges 提交后边会同步回 v-model 绑定的 edges ref。
    // 绕过 addEdges 的实现（直接 push 边数组）不会触发此写回——
    // 在真实环境里对应「store 里有边、Vue Flow 内部没有」的状态撕裂。
    vi.mocked(addEdges).mockImplementation((input: Edge | Edge[]) => {
      const list = Array.isArray(input) ? input : [input]
      edges.value = [...edges.value, ...list]
    })
    mockReconcileAll.mockClear()
  })

  it('模块返回对象上暴露 batchAddEdges 函数', () => {
    expect(typeof module.batchAddEdges, '应在 connectionOps 模块返回对象上暴露 batchAddEdges').toBe(
      'function'
    )
  })

  it('批量加边：全部边经 Vue Flow API 提交并进入画布边集合', () => {
    const batch = [
      makeEdge('b1', 's1', 'c1'),
      makeEdge('b2', 's1', 'c2'),
      makeEdge('b3', 's2', 'c3'),
      makeEdge('b4', 's2', 'c4'),
      makeEdge('b5', 's3', 'c5'),
    ]

    module.batchAddEdges!(batch)

    // 边必须经 Vue Flow 原生 API 提交（否则 Vue Flow 内部状态丢失这些边）
    expect(vi.mocked(addEdges).mock.calls.length, 'batchAddEdges 应经 Vue Flow API 提交边').toBeGreaterThan(0)
    const submitted = collectedEdgeIds()
    for (const id of ['b1', 'b2', 'b3', 'b4', 'b5']) {
      expect(submitted, `边 ${id} 应经 addEdges 提交`).toContain(id)
    }
    // 无重复提交
    expect(new Set(submitted).size).toBe(submitted.length)

    // 提交后画布边集合（store ref）应包含全部边
    const inStore = edges.value.map((e) => e.id)
    for (const id of ['b1', 'b2', 'b3', 'b4', 'b5']) {
      expect(inStore, `边 ${id} 应在画布边集合中`).toContain(id)
    }
  })

  it('批量加边后触发一次连接状态重建（reconcile，可 nextTick 合并调度）', async () => {
    module.batchAddEdges!([makeEdge('b1', 's1', 'c1'), makeEdge('b2', 's2', 'c2')])
    await nextTick()
    expect(mockReconcileAll).toHaveBeenCalled()
  })

  it('空数组安全：不抛异常、不产生副作用', async () => {
    expect(() => module.batchAddEdges!([])).not.toThrow()
    await nextTick()
    expect(edges.value).toHaveLength(0)
    expect(mockReconcileAll).not.toHaveBeenCalled()
  })

  it('不回归：createConnection 仍经 addEdges 单条提交', () => {
    const edgeId = module.createConnection('s1', 'c1', 'source-right-col1', 'target-input-c1')
    expect(typeof edgeId).toBe('string')
    expect(vi.mocked(addEdges)).toHaveBeenCalledTimes(1)
    const submitted = collectedEdgeIds()
    expect(submitted).toHaveLength(1)
  })
})

describe('X04 — 类型引用防误改', () => {
  it('模块签名仍接受既有 DI 参数（updateNodeData 等不缺席）', () => {
    // createConnectionOpsModule 的 DI 契约若被顺手改坏，构造时即抛错
    const nodes = ref<CustomNode[]>([])
    const edges = ref<Edge[]>([])
    expect(() =>
      createConnectionOpsModule({
        nodes,
        edges,
        updateNodeData: (_id: string, _d: Partial<CustomNodeData>) => {},
        clearAllValidationErrors: (_id: string) => {},
        syncOnDisconnect: (_e: Edge) => {},
        reconcileAll: () => {},
      })
    ).not.toThrow()
  })
})

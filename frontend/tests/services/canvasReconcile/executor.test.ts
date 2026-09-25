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
 * @fileoverview executor 单元测试：rebuild/remove 执行路径、added/updated 运行时归类、
 * refreshExisting 选项、失败收集不中断、模式切换窗口期静默降级、选中保持
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  executeReconcilePlan,
  aggregateReconcileOutcomes,
  type ReconcileDeps,
} from '@/services/canvasReconcile/executor'
import { planFromChangeSet } from '@/services/canvasReconcile/planFromChangeSet'
import type { ChangeSetEnvelope } from '@/services/canvasReconcile/envelope'

const mocks = vi.hoisted(() => {
  class VueFlowApiNotInitializedError extends Error {
    constructor(message = 'VueFlow API not initialized') {
      super(message)
      this.name = 'VueFlowApiNotInitializedError'
    }
  }
  return { loggerWarn: vi.fn(), VueFlowApiNotInitializedError }
})

vi.mock('@/services/canvas/vueFlowApi', () => ({
  VueFlowApiNotInitializedError: mocks.VueFlowApiNotInitializedError,
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { warn: mocks.loggerWarn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

function makeEnvelope(overrides: Partial<ChangeSetEnvelope> = {}): ChangeSetEnvelope {
  const op = overrides.op ?? 'add'
  const kind = overrides.kind ?? 'schema'
  const entityId = overrides.entityId ?? 'users'
  return {
    instructionId: overrides.instructionId ?? `${op}:${kind}:${entityId}`,
    actionType: overrides.actionType ?? 'ADD_SCHEMA',
    op,
    kind,
    entityId,
    filePath: overrides.filePath ?? `${kind}s/${entityId}.yaml`,
  }
}

/** 可变画布节点集合 + 依赖注入桩（import 语义：节点不存在则添加） */
function makeDeps(overrides: Partial<ReconcileDeps> = {}) {
  const nodeIds = new Set<string>()
  /** 标记为 draft 的节点（用户未保存的编辑，快照重放保护判据） */
  const draftIds = new Set<string>()
  const importer = vi.fn(async (kind: string, id: string) => {
    nodeIds.add(id)
    return id
  })
  const deleter = vi.fn(async (id: string) => {
    nodeIds.delete(id)
  })
  const selectedNodeId = { current: null as string | null }
  const deps: ReconcileDeps = {
    nodes: () =>
      [...nodeIds].map((id) => ({
        id,
        position: { x: 0, y: 0 },
        saveState: draftIds.has(id) ? 'draft' : 'saved',
      })),
    importV2ResourceToCanvas: importer as unknown as ReconcileDeps['importV2ResourceToCanvas'],
    deleteNode: deleter,
    positionFor: () => ({ x: 0, y: 0 }),
    fitViewNode: vi.fn(),
    getSelectedNodeId: () => selectedNodeId.current,
    setSelectedNodeId: (id) => {
      selectedNodeId.current = id
    },
    ...overrides,
  }
  return { nodeIds, draftIds, importer, deleter, selectedNodeId, deps }
}

const HYDRATE_OPTS_BASE = {
  includeDeps: false,
  moveIfExists: false,
  skipRelatedConstraints: true,
  recordHistory: false,
}

describe('executeReconcilePlan', () => {
  beforeEach(() => {
    mocks.loggerWarn.mockClear()
  })

  it('rebuild 新实体归为 added，传 refreshExisting:false（创建路径）', async () => {
    const { deps, importer } = makeDeps()
    const plan = planFromChangeSet([makeEnvelope()])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(outcome.added).toEqual(['users'])
    expect(outcome.updated).toEqual([])
    expect(importer).toHaveBeenCalledWith(
      'schema',
      'users',
      { x: 0, y: 0 },
      { ...HYDRATE_OPTS_BASE, refreshExisting: false }
    )
    expect(deps.fitViewNode).toHaveBeenCalledWith('users')
  })

  it('rebuild 已存在实体传 refreshExisting:true（原地刷新语义），归为 updated', async () => {
    const { nodeIds, importer, deps } = makeDeps()
    nodeIds.add('users')
    const plan = planFromChangeSet([makeEnvelope({ op: 'update' })])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(importer).toHaveBeenCalledWith(
      'schema',
      'users',
      { x: 0, y: 0 },
      { ...HYDRATE_OPTS_BASE, refreshExisting: true }
    )
    expect(outcome.added).toEqual([])
    expect(outcome.updated).toEqual(['users'])
  })

  it('add 信封对已存在实体也传 refreshExisting:true（契约"已存在则幂等刷新"）', async () => {
    const { nodeIds, importer, deps } = makeDeps()
    nodeIds.add('users')
    const plan = planFromChangeSet([makeEnvelope({ op: 'add' })])

    await executeReconcilePlan(plan, deps)

    expect(importer).toHaveBeenCalledWith(
      'schema',
      'users',
      expect.anything(),
      expect.objectContaining({ refreshExisting: true })
    )
  })

  it('remove 已存在节点：deleteNode 带 recordHistory:false（不入撤销栈），计入 removed', async () => {
    const { nodeIds, deleter, deps } = makeDeps()
    nodeIds.add('c1')
    const plan = planFromChangeSet([
      makeEnvelope({ op: 'remove', kind: 'constraint', entityId: 'c1' }),
    ])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(deleter).toHaveBeenCalledWith('c1', { recordHistory: false })
    expect(outcome.removed).toEqual(['c1'])
    expect(nodeIds.has('c1')).toBe(false)
  })

  it('remove 不存在节点是 no-op（契约语义，不计入 removed）', async () => {
    const { deleter, deps } = makeDeps()
    const plan = planFromChangeSet([makeEnvelope({ op: 'remove', entityId: 'ghost' })])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(deleter).not.toHaveBeenCalled()
    expect(outcome.removed).toEqual([])
    expect(outcome.failed).toEqual([])
  })

  it('同实体 remove → rebuild 序列按时间序执行（删后重建）', async () => {
    const { nodeIds, deps } = makeDeps()
    nodeIds.add('users')
    const plan = planFromChangeSet([
      makeEnvelope({ op: 'remove', entityId: 'users' }),
      makeEnvelope({ entityId: 'users' }),
    ])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(outcome.removed).toEqual(['users'])
    expect(outcome.added).toEqual(['users'])
    expect(nodeIds.has('users')).toBe(true)
  })

  it('importer 返回 null（资源不存在）计入 failed，不中断后续操作', async () => {
    const { deps, importer } = makeDeps()
    importer.mockResolvedValueOnce(null)
    const plan = planFromChangeSet([
      makeEnvelope({ entityId: 'missing' }),
      makeEnvelope({ entityId: 'ok' }),
    ])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]).toMatchObject({
      instructionId: 'add:schema:missing',
      entityId: 'missing',
    })
    expect(outcome.added).toEqual(['ok'])
  })

  it('importer 抛异常计入 failed，不中断后续操作', async () => {
    const { deps, importer } = makeDeps()
    importer.mockRejectedValueOnce(new Error('boom'))
    const plan = planFromChangeSet([
      makeEnvelope({ entityId: 'bad' }),
      makeEnvelope({ entityId: 'ok' }),
    ])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]).toMatchObject({ entityId: 'bad', error: 'boom' })
    expect(outcome.added).toEqual(['ok'])
  })

  it('VueFlowApiNotInitializedError（模式切换窗口期）静默跳过：不计 failed、只记 warn', async () => {
    const { deps, importer } = makeDeps()
    importer.mockRejectedValueOnce(new mocks.VueFlowApiNotInitializedError())
    const plan = planFromChangeSet([
      makeEnvelope({ entityId: 'in-window' }),
      makeEnvelope({ entityId: 'after' }),
    ])

    const outcome = await executeReconcilePlan(plan, deps)

    // 窗口期条目被跳过（不触发"建议重新加载项目"的失败误导），后续条目照常
    expect(outcome.failed).toEqual([])
    expect(outcome.added).toEqual(['after'])
    expect(mocks.loggerWarn).toHaveBeenCalled()
  })

  it('选中保持：对账前后 selectedNodeId 不变（对齐 hydrate 范本，不抢检查器）', async () => {
    const { nodeIds, selectedNodeId, deps } = makeDeps()
    nodeIds.add('other-node')
    selectedNodeId.current = 'other-node'
    const plan = planFromChangeSet([makeEnvelope({ entityId: 'users' })])

    await executeReconcilePlan(plan, deps)

    expect(selectedNodeId.current).toBe('other-node')

    // 选中为 null 时同样恢复为 null（导入器内部可能设置过）
    selectedNodeId.current = null
    await executeReconcilePlan(planFromChangeSet([makeEnvelope({ entityId: 'x' })]), deps)
    expect(selectedNodeId.current).toBeNull()
  })

  it('remove 不恢复选中：删除选中节点后 selectedNodeId 保持 null（无悬空选中）', async () => {
    const { nodeIds, deleter, selectedNodeId, deps } = makeDeps()
    nodeIds.add('doomed')
    selectedNodeId.current = 'doomed'
    // deleter 模拟 nodeOps.deleteNode 的选中清理：删的是选中节点 → 置 null
    deleter.mockImplementation(async (id: string) => {
      nodeIds.delete(id)
      if (selectedNodeId.current === id) selectedNodeId.current = null
    })
    const plan = planFromChangeSet([makeEnvelope({ op: 'remove', entityId: 'doomed' })])

    await executeReconcilePlan(plan, deps)

    // 若 remove 分支也无脑 restore，会把刚删除的 'doomed' 写回 selectedNodeId
    expect(selectedNodeId.current).toBeNull()
    expect(deps.nodes().some((n) => n.id === 'doomed')).toBe(false)
  })

  it('draft 保护：快照重放跳过带未保存编辑的节点（不覆盖、不计桶、不报错）', async () => {
    const { nodeIds, draftIds, importer, deps } = makeDeps()
    nodeIds.add('users')
    draftIds.add('users') // 用户正在编辑、尚未保存
    const plan = planFromChangeSet([makeEnvelope({ op: 'update', entityId: 'users' })])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(importer).not.toHaveBeenCalled() // 不触发磁盘重读覆盖
    expect(outcome.added).toEqual([])
    expect(outcome.updated).toEqual([])
    expect(outcome.removed).toEqual([])
    expect(outcome.failed).toEqual([]) // 跳过是刻意保护，不是错误
    expect(draftIds.has('users')).toBe(true) // draft 状态原样保留
  })

  it('非 draft 的已存在节点照常刷新（draft 保护不误伤正常重放）', async () => {
    const { nodeIds, importer, deps } = makeDeps()
    nodeIds.add('users') // saveState: 'saved'
    const plan = planFromChangeSet([makeEnvelope({ op: 'update', entityId: 'users' })])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(importer).toHaveBeenCalledWith(
      'schema',
      'users',
      expect.anything(),
      expect.objectContaining({ refreshExisting: true })
    )
    expect(outcome.updated).toEqual(['users'])
  })

  it('deleteNode 抛异常计入 failed，不中断后续操作', async () => {
    const { nodeIds, deps, deleter } = makeDeps()
    nodeIds.add('bad')
    nodeIds.add('good')
    deleter.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('delete failed')
      nodeIds.delete(id)
    })
    const plan = planFromChangeSet([
      makeEnvelope({ op: 'remove', entityId: 'bad' }),
      makeEnvelope({ op: 'remove', entityId: 'good' }),
    ])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]).toMatchObject({ entityId: 'bad', error: 'delete failed' })
    expect(outcome.removed).toEqual(['good'])
  })

  it('预留 kind（manualData/template）的 rebuild 明确失败（契约漂移可见）', async () => {
    const { deps, importer } = makeDeps()
    const plan = planFromChangeSet([makeEnvelope({ kind: 'manualData', entityId: 'md1' })])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(importer).not.toHaveBeenCalled()
    expect(outcome.failed[0].error).toContain('manualData')
  })

  it('预留 kind 的 remove 不被 kind 限制拦截（按实体删节点与 kind 无关）', async () => {
    const { nodeIds, deleter, deps } = makeDeps()
    nodeIds.add('md1')
    const plan = planFromChangeSet([
      makeEnvelope({ op: 'remove', kind: 'manualData', entityId: 'md1' }),
    ])

    const outcome = await executeReconcilePlan(plan, deps)

    expect(deleter).toHaveBeenCalledWith('md1', { recordHistory: false })
    expect(outcome.removed).toEqual(['md1'])
  })
})

describe('aggregateReconcileOutcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('聚合多批次计数与失败清单，touchedEntityIds 去重', () => {
    const agg = aggregateReconcileOutcomes([
      {
        added: ['a', 'b'],
        updated: [],
        removed: ['x'],
        failed: [{ instructionId: 'i', entityId: 'z', error: 'e' }],
      },
      { added: [], updated: ['a', 'c'], removed: [], failed: [] },
    ])
    expect(agg).toEqual({
      added: 2,
      updated: 2,
      removed: 1,
      failed: [{ instructionId: 'i', entityId: 'z', error: 'e' }],
      touchedEntityIds: ['a', 'b', 'x', 'c'],
    })
  })

  it('空结果聚合为全零', () => {
    expect(aggregateReconcileOutcomes([])).toEqual({
      added: 0,
      updated: 0,
      removed: 0,
      failed: [],
      touchedEntityIds: [],
    })
  })
})

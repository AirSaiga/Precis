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
 * @fileoverview aiChatInstructionService 单元测试（v2 变更集对账口径）
 *
 * 核心覆盖：
 * - 信封（envelope）→ 对账队列 → importV2ResourceToCanvas 磁盘重读幂等导入
 * - remove 信封 → graphStore.deleteNode 级联删除
 - 画布节点 id 恒等于磁盘实体 id（entityId），不再生成随机 uuid
 * - 非法形状丢弃、同实体 add+update 折叠、队列串行
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processFrontendInstructions } from '@/services/aiChatInstructionService'

const mocks = vi.hoisted(() => {
  class VueFlowApiNotInitializedError extends Error {
    constructor(message = 'VueFlow API not initialized') {
      super(message)
      this.name = 'VueFlowApiNotInitializedError'
    }
  }
  return {
    // vueFlowApi 边界（canvasOps 顶层 import 该 class，mock 缺此导出会是 undefined，
    // instanceof 守卫静默失效——历史上踩过的坑）
    fitView: vi.fn(),
    findNode: vi.fn(),
    VueFlowApiNotInitializedError,
    // graphStore 边界
    nodes: [] as Array<{ id: string; position: { x: number; y: number } }>,
    importV2ResourceToCanvas: vi.fn(),
    deleteNode: vi.fn(),
    // logger
    loggerWarn: vi.fn(),
  }
})

vi.mock('@/services/canvas/vueFlowApi', () => ({
  fitView: mocks.fitView,
  findNode: mocks.findNode,
  VueFlowApiNotInitializedError: mocks.VueFlowApiNotInitializedError,
}))

vi.mock('@/stores/graphStore', () => ({
  useGraphStore: () => ({
    nodes: mocks.nodes,
    importV2ResourceToCanvas: mocks.importV2ResourceToCanvas,
    deleteNode: mocks.deleteNode,
  }),
}))

vi.mock('@/core/utils/logger', () => ({
  logger: { warn: mocks.loggerWarn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

function makeEnvelope(overrides: Record<string, unknown> = {}) {
  const op = (overrides.op ?? 'add') as string
  const kind = (overrides.kind ?? 'schema') as string
  const entityId = (overrides.entityId ?? 'users') as string
  return {
    instructionId: `${op}:${kind}:${entityId}`,
    actionType: overrides.actionType ?? 'ADD_SCHEMA',
    op,
    kind,
    entityId,
    filePath: overrides.filePath ?? `${kind}s/${entityId}.yaml`,
    ...overrides,
  }
}

describe('aiChatInstructionService（v2 变更集对账）', () => {
  beforeEach(() => {
    mocks.nodes.length = 0
    mocks.importV2ResourceToCanvas.mockReset()
    mocks.deleteNode.mockReset()
    mocks.fitView.mockReset()
    mocks.loggerWarn.mockReset()
    mocks.importV2ResourceToCanvas.mockImplementation(async (_kind: string, id: string) => id)
  })

  it('add 信封 → importV2ResourceToCanvas 磁盘重读（hydrate 同款选项），画布节点 id == entityId', async () => {
    const p = processFrontendInstructions([makeEnvelope()])
    expect(p).not.toBeNull()
    const outcome = await p!

    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledTimes(1)
    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledWith(
      'schema',
      'users',
      { x: 100, y: 100 }, // 空画布默认落点
      {
        includeDeps: false,
        moveIfExists: false,
        skipRelatedConstraints: true,
        recordHistory: false,
        refreshExisting: false, // 节点不存在 → 创建路径
      }
    )
    expect(outcome.added).toEqual(['users'])
  })

  it('update 信封对已存在节点 → 原地刷新路径（refreshExisting:true），归类 updated', async () => {
    mocks.nodes.push({ id: 'notnull_users_email', position: { x: 0, y: 0 } })
    const outcome = await processFrontendInstructions([
      makeEnvelope({ op: 'update', kind: 'constraint', entityId: 'notnull_users_email' }),
    ])!

    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledWith(
      'constraint',
      'notnull_users_email',
      expect.anything(),
      expect.objectContaining({ recordHistory: false, refreshExisting: true })
    )
    expect(outcome.updated).toEqual(['notnull_users_email'])
    expect(outcome.added).toEqual([])
  })

  it('remove 信封 → graphStore.deleteNode(entityId, recordHistory:false)；不存在则 no-op', async () => {
    mocks.nodes.push({ id: 'users', position: { x: 0, y: 0 } })
    const outcome = await processFrontendInstructions([makeEnvelope({ op: 'remove' })])!

    expect(mocks.deleteNode).toHaveBeenCalledWith('users', { recordHistory: false })
    expect(outcome.removed).toEqual(['users'])

    // 节点不存在：no-op，不报错
    mocks.deleteNode.mockClear()
    const outcome2 = await processFrontendInstructions([
      makeEnvelope({ op: 'remove', entityId: 'ghost' }),
    ])!
    expect(mocks.deleteNode).not.toHaveBeenCalled()
    expect(outcome2.removed).toEqual([])
  })

  it('内联约束降级为 update:schema:宿主id（后端已降级，前端只重读宿主 schema）', async () => {
    mocks.nodes.push({ id: 'users', position: { x: 0, y: 0 } })
    const outcome = await processFrontendInstructions([
      makeEnvelope({
        instructionId: 'update:schema:users',
        actionType: 'ADD_CONSTRAINT_NODE', // 内联保留原 actionType 供遥测
        op: 'update',
        kind: 'schema',
        entityId: 'users',
      }),
    ])!
    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledWith(
      'schema',
      'users',
      expect.anything(),
      expect.anything()
    )
    expect(outcome.updated).toEqual(['users'])
  })

  it('非法形状丢弃：不触发画布操作，记 warn', async () => {
    const outcome = await processFrontendInstructions([
      { actionType: 'ADD_SCHEMA', constraintSpec: { type: 'NOT_NULL' } }, // v1 镜像形状
      'not-an-object',
      null,
    ])
    if (outcome) await outcome
    expect(mocks.importV2ResourceToCanvas).not.toHaveBeenCalled()
    expect(mocks.loggerWarn).toHaveBeenCalled()
  })

  it('空数组返回 null（调用方跳过聚合）', () => {
    expect(processFrontendInstructions([])).toBeNull()
  })

  it('同实体 add+update 折叠为一次磁盘重读', async () => {
    const outcome = await processFrontendInstructions([
      makeEnvelope({ entityId: 'users' }),
      makeEnvelope({ op: 'update', entityId: 'users' }),
    ])!
    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledTimes(1)
    expect(outcome.added).toEqual(['users'])
  })

  it('同 instructionId 重复送达只执行一次（completed 快照兜底 + 流式双通道）', async () => {
    const outcome = await processFrontendInstructions([
      makeEnvelope({ entityId: 'users' }),
      makeEnvelope({ entityId: 'users' }),
    ])!
    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledTimes(1)
    expect(outcome.added).toEqual(['users'])
  })

  it('import 失败计入 failed 且不中断后续条目', async () => {
    mocks.importV2ResourceToCanvas
      .mockResolvedValueOnce(null) // 第一条：资源缺失
      .mockRejectedValueOnce(new Error('disk read error')) // 第二条：异常
    const outcome = await processFrontendInstructions([
      makeEnvelope({ entityId: 'bad1' }),
      makeEnvelope({ entityId: 'bad2' }),
      makeEnvelope({ entityId: 'good' }),
    ])!
    expect(outcome.failed).toHaveLength(2)
    expect(outcome.failed.map((f) => f.entityId)).toEqual(['bad1', 'bad2'])
    expect(outcome.added).toEqual(['good'])
  })

  it('串行队列：后一批在前一批 import 落定前不启动', async () => {
    let resolveFirst!: (v: string | null) => void
    mocks.importV2ResourceToCanvas.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveFirst = r
        })
    )

    const p1 = processFrontendInstructions([makeEnvelope({ entityId: 'a' })])
    const p2 = processFrontendInstructions([makeEnvelope({ entityId: 'b' })])

    // 第一批挂起（tail.then 微任务起动后）：第二批不得启动
    await vi.waitFor(() => expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledTimes(1)

    resolveFirst('a')
    await p1
    await p2
    expect(mocks.importV2ResourceToCanvas).toHaveBeenCalledTimes(2)
  })
})

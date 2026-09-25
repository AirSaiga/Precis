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
 * @fileoverview reconcileQueue 单元测试：全局串行顺序（可控 Promise）、
 * pending-id coalescing、批间失败隔离
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createReconcileQueue } from '@/services/canvasReconcile/reconcileQueue'
import type { ReconcileDeps } from '@/services/canvasReconcile/executor'
import type { ChangeSetEnvelope } from '@/services/canvasReconcile/envelope'

vi.mock('@/core/utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

function makeEnvelope(entityId: string, op: ChangeSetEnvelope['op'] = 'add'): ChangeSetEnvelope {
  const kind = 'schema'
  return {
    instructionId: `${op}:${kind}:${entityId}`,
    actionType: 'ADD_SCHEMA',
    op,
    kind,
    entityId,
    filePath: `schemas/${entityId}.yaml`,
  }
}

/** 手动控制 resolve 时机的 importer：证明批间/条间严格串行 */
function makeDeferredDeps() {
  const nodeIds = new Set<string>()
  const pendingImports: Array<{
    id: string
    resolve: (v: string | null) => void
    reject: (e: Error) => void
  }> = []
  const importer = vi.fn(
    (kind: string, id: string) =>
      new Promise<string | null>((resolve, reject) => {
        pendingImports.push({ id, resolve, reject })
      })
  )
  const deps: ReconcileDeps = {
    nodes: () => [...nodeIds].map((id) => ({ id, position: { x: 0, y: 0 } })),
    importV2ResourceToCanvas: importer as unknown as ReconcileDeps['importV2ResourceToCanvas'],
    deleteNode: vi.fn(async (id: string) => {
      nodeIds.delete(id)
    }),
    positionFor: () => ({ x: 0, y: 0 }),
  }
  return {
    nodeIds,
    importer,
    deps,
    /** resolve 第 n 个未决 import（0 基） */
    resolveNth(n: number, value: string | null = null) {
      const entry = pendingImports[n]
      if (!entry) throw new Error(`no pending import #${n}`)
      if (value !== null) nodeIds.add(value)
      entry.resolve(value)
    },
    rejectNth(n: number, err: Error) {
      pendingImports[n].reject(err)
    },
    pendingCount: () => pendingImports.length,
  }
}

describe('reconcileQueue 串行执行', () => {
  it('后一批在前一批 resolve 前不启动（可控 Promise 证明串行）', async () => {
    const d = makeDeferredDeps()
    const queue = createReconcileQueue(d.deps)

    const p1 = queue.enqueueChangeSet([makeEnvelope('a')])
    // 第一批第一条已启动（importer 挂起未决；tail.then 链需一个微任务才起动）
    await vi.waitFor(() => expect(d.pendingCount()).toBe(1))

    const p2 = queue.enqueueChangeSet([makeEnvelope('b')])
    // 第二批不得启动：importer 仍只有第一批的那一次调用
    await Promise.resolve()
    expect(d.pendingCount()).toBe(1)
    expect(d.importer).toHaveBeenCalledTimes(1)

    // resolve 第一批 → 第二批才启动
    d.resolveNth(0, 'a')
    await p1
    await vi.waitFor(() => expect(d.pendingCount()).toBe(2))
    d.resolveNth(1, 'b')
    const out2 = await p2
    expect(out2.added).toEqual(['b'])
  })

  it('同批内逐条串行：上一条未 resolve 时下一条不启动', async () => {
    const d = makeDeferredDeps()
    const queue = createReconcileQueue(d.deps)

    const p = queue.enqueueChangeSet([makeEnvelope('a'), makeEnvelope('b')])
    await vi.waitFor(() => expect(d.pendingCount()).toBe(1))
    d.resolveNth(0, 'a')
    await vi.waitFor(() => expect(d.pendingCount()).toBe(2))
    d.resolveNth(1, 'b')
    const out = await p
    expect(out.added).toEqual(['a', 'b'])
  })

  it('前一批执行器抛异常不断链：后一批照常执行（失败批以 failed 条目收场）', async () => {
    const d = makeDeferredDeps()
    const queue = createReconcileQueue(d.deps)

    const p1 = queue.enqueueChangeSet([makeEnvelope('bad')])
    const p2 = queue.enqueueChangeSet([makeEnvelope('good')])
    await vi.waitFor(() => expect(d.pendingCount()).toBe(1))

    d.rejectNth(0, new Error('first batch boom'))
    const out1 = await p1
    expect(out1.failed).toHaveLength(1)
    expect(out1.failed[0]).toMatchObject({ entityId: 'bad', error: 'first batch boom' })

    await vi.waitFor(() => expect(d.pendingCount()).toBe(2))
    d.resolveNth(1, 'good')
    const out2 = await p2
    expect(out2.added).toEqual(['good'])
  })

  it('pending 中的同 instructionId 重复入队被 coalesce（EventJournal 重放）', async () => {
    const d = makeDeferredDeps()
    const queue = createReconcileQueue(d.deps)

    const p1 = queue.enqueueChangeSet([makeEnvelope('a')])
    await vi.waitFor(() => expect(d.pendingCount()).toBe(1))
    // 第一批挂起期间同信封再入队 → 空批直接返回，不产生第二次 import
    const p1Replay = queue.enqueueChangeSet([makeEnvelope('a')])
    await p1Replay
    expect(d.importer).toHaveBeenCalledTimes(1)

    expect(queue.pendingInstructionIds().has('add:schema:a')).toBe(true)
    d.resolveNth(0, 'a')
    await p1
    expect(queue.pendingInstructionIds().has('add:schema:a')).toBe(false)
  })

  it('同批次内同实体多操作豁免 coalescing（删后重建序列不被部分跳过）', async () => {
    const d = makeDeferredDeps()
    const queue = createReconcileQueue(d.deps)

    // 第一批 add:a 挂起中
    const p1 = queue.enqueueChangeSet([makeEnvelope('a')])
    await vi.waitFor(() => expect(d.pendingCount()).toBe(1))

    // 第二批是同实体的 [remove, add]（末见去重后 plan 为 [remove, rebuild]，仍两条操作）：
    // add:a 的 id 在 pending 中，但实体多操作 → 不得跳过，否则终态错误为"已删"
    const p2 = queue.enqueueChangeSet([makeEnvelope('a', 'remove'), makeEnvelope('a')])
    d.resolveNth(0, 'a')
    await p1

    // 第二批两条操作都执行（remove 走 deleteNode，rebuild 再 import）
    await vi.waitFor(() => expect(d.pendingCount()).toBe(2))
    d.resolveNth(1, 'a')
    const out2 = await p2
    expect(out2.removed).toEqual(['a'])
    expect(out2.added).toEqual(['a'])
  })

  it('已完成的 instructionId 再次入队不被跳过（删后重建依赖此语义）', async () => {
    const d = makeDeferredDeps()
    const queue = createReconcileQueue(d.deps)

    const p1 = queue.enqueueChangeSet([makeEnvelope('a')])
    await vi.waitFor(() => expect(d.pendingCount()).toBe(1))
    d.resolveNth(0, 'a')
    await p1

    // 同 id 信封再次到达（前一批已完成）：重新执行（磁盘重读幂等）
    const p2 = queue.enqueueChangeSet([makeEnvelope('a')])
    await vi.waitFor(() => expect(d.pendingCount()).toBe(2))
    d.resolveNth(1, 'a')
    const out2 = await p2
    expect(out2.added).toEqual([]) // 节点已存在 → updated
    expect(out2.updated).toEqual(['a'])
  })

  it('空批立即返回空结果，不入队', async () => {
    const d = makeDeferredDeps()
    const queue = createReconcileQueue(d.deps)
    const out = await queue.enqueueChangeSet([])
    expect(out).toEqual({ added: [], updated: [], removed: [], failed: [] })
    expect(d.importer).not.toHaveBeenCalled()
  })
})

describe('reconcileQueue 全部条目失败后仍 resolve（不 reject）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('整批失败以 failed 条目收场', async () => {
    const d = makeDeferredDeps()
    const queue = createReconcileQueue(d.deps)
    const p = queue.enqueueChangeSet([makeEnvelope('x')])
    await vi.waitFor(() => expect(d.pendingCount()).toBe(1))
    d.rejectNth(0, new Error('kaboom'))
    const out = await p
    expect(out.failed).toEqual([expect.objectContaining({ entityId: 'x', error: 'kaboom' })])
  })
})

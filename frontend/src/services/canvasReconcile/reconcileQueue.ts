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
 * @fileoverview 画布对账全局串行队列：AI 变更集信封的唯一入口。
 *
 * 全局单队列（跨消息共享）保证对账操作与用户并发的画布操作不交错；
 * 每批 enqueueChangeSet 返回的 Promise 在本批操作全部完成后 resolve。
 * 生产环境用 graphStore 绑定的默认依赖；测试用 createReconcileQueue 注入。
 */

import { useGraphStore } from '@/stores/graphStore'
import type { ChangeSetEnvelope } from './envelope'
import { planFromChangeSet } from './planFromChangeSet'
import {
  emptyReconcileOutcome,
  executeReconcilePlan,
  type ReconcileDeps,
  type ReconcileOutcome,
} from './executor'
import { computePlacementPosition, debouncedFitView } from './canvasOps'

export interface ReconcileQueue {
  /**
   * 信封批量入队（同批内做 planFromChangeSet 去重折叠）。
   * 返回的 Promise 在本批执行完毕后 resolve（失败条目在 outcome.failed，不 reject）。
   */
  enqueueChangeSet(envelopes: ChangeSetEnvelope[]): Promise<ReconcileOutcome>
  /** 仍在排队/执行中的 instructionId 快照（供流式通道跳过明显重复） */
  pendingInstructionIds(): Set<string>
}

/**
 * 创建一个串行对账队列。批间串行（chain promise），批内由 executor 逐条串行执行。
 *
 * 同 instructionId 且**仍在排队/执行中**的条目会被跳过（coalescing 优化，吸收
 * EventJournal 重放造成的重复送达），但**同批次内同实体有多条操作时豁免**——
 * [remove X, rebuild X] 这类删后重建序列若被部分跳过会得到错误终态。
 * 已完成的条目再次入队不会被跳过——执行本身磁盘重读幂等，时序场景依然正确。
 */
export function createReconcileQueue(deps: ReconcileDeps): ReconcileQueue {
  let tail: Promise<unknown> = Promise.resolve()
  const pendingIds = new Set<string>()

  return {
    enqueueChangeSet(envelopes: ChangeSetEnvelope[]): Promise<ReconcileOutcome> {
      if (envelopes.length === 0) return Promise.resolve(emptyReconcileOutcome())

      // 实体多操作批次豁免 coalescing：该实体的任何条目都不跳过（保序执行）
      const opCountByEntity = new Map<string, number>()
      for (const env of envelopes) {
        opCountByEntity.set(env.entityId, (opCountByEntity.get(env.entityId) ?? 0) + 1)
      }
      const fresh = envelopes.filter((env) => {
        if (!pendingIds.has(env.instructionId)) return true
        return (opCountByEntity.get(env.entityId) ?? 0) > 1
      })
      if (fresh.length === 0) return Promise.resolve(emptyReconcileOutcome())

      const plan = planFromChangeSet(fresh)
      if (plan.ops.length === 0) return Promise.resolve(emptyReconcileOutcome())

      for (const op of plan.ops) pendingIds.add(op.instructionId)
      const run = tail
        .then(() => executeReconcilePlan(plan, deps))
        .finally(() => {
          for (const op of plan.ops) pendingIds.delete(op.instructionId)
        })
      // 队列尾吞掉 reject（结果经 run 传递），避免单批异常断链后续批次
      tail = run.catch(() => undefined)
      return run
    },
    pendingInstructionIds(): Set<string> {
      return new Set(pendingIds)
    },
  }
}

/** 从节点 data 读取 saveState（判别联合无索引签名，运行时判型零断言读取） */
function readSaveState(data: unknown): unknown {
  return data !== null && typeof data === 'object'
    ? (data as Record<string, unknown>).saveState
    : undefined
}

/** 生产环境默认依赖：绑定 graphStore（延迟解析，避免模块加载期实例化 Pinia store） */
function makeGraphStoreDeps(): ReconcileDeps {
  const getStore = () => useGraphStore()
  return {
    nodes: () =>
      getStore().nodes.map((n) => ({
        id: n.id,
        position: n.position,
        saveState: readSaveState(n.data),
      })),
    importV2ResourceToCanvas: (kind, resourceId, position, options) =>
      getStore().importV2ResourceToCanvas(kind, resourceId, position, options),
    deleteNode: (nodeId, options) => getStore().deleteNode(nodeId, options),
    positionFor: () => computePlacementPosition(getStore()),
    fitViewNode: (nodeId) => debouncedFitView([nodeId]),
    // 选中保持（对齐 hydrate 范本：对账是后台同步，不抢用户选中）
    getSelectedNodeId: () => getStore().selectedNodeId ?? null,
    setSelectedNodeId: (id) => {
      getStore().selectedNodeId = id
    },
  }
}

/** 全局单队列（应用生命周期内共享） */
let globalQueue: ReconcileQueue | null = null

/** 获取全局对账队列（懒初始化，首次调用时绑定 graphStore 依赖） */
export function getReconcileQueue(): ReconcileQueue {
  if (!globalQueue) {
    globalQueue = createReconcileQueue(makeGraphStoreDeps())
  }
  return globalQueue
}

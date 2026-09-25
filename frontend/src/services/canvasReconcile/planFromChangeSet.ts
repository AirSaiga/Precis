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
 * @fileoverview 变更集信封 → 画布对账操作计划的纯函数规划器。
 *
 * planFromChangeSet 只做去重/折叠/定序，不触碰画布、无副作用，可独立单测。
 * 实际执行由 executor.ts 完成（rebuild → 磁盘重读幂等导入；remove → 级联删除）。
 */

import type { ChangeSetEnvelope } from './envelope'

/** 计划中的单条操作（折叠后的最小执行单元） */
export interface ReconcilePlanOp {
  instructionId: string
  /** rebuild=以磁盘为准重建节点（add/update 折叠后的统一动作）；remove=级联删除画布节点 */
  op: 'rebuild' | 'remove'
  kind: ChangeSetEnvelope['kind']
  entityId: string
  filePath: string
}

/** 一批信封折叠去重后的执行计划（保持时间序） */
export interface ReconcilePlan {
  ops: ReconcilePlanOp[]
}

/**
 * 信封列表 → 操作计划。纯函数。
 *
 * 规则：
 * 1. **instructionId 去重（末见保留）**：同一 instructionId 保留**最后一次**出现
 *    （EventJournal 重放与 completed 快照兜底双通道会重复送达；信封确定性保证相同
 *    id 即相同内容）。末见而非首见：同一条消息内"删文件后重建同 id 实体"会产出两条
 *    相同的 add:{kind}:{id}，首见保留会留下过时的早位置（[add,remove,add] 首见去重
 *    → [add,remove] 终态错误地为"已删"；末见去重 → [remove,add] 正确重建）。
 * 2. **同实体 add+update 折叠**：add 与 update 对执行器是同一动作——"以磁盘为准
 *    重建"（importV2ResourceToCanvas 幂等重读），折叠为一次 rebuild 避免同文件
 *    双读。折叠后的操作落在**最后一次出现的位置**（跨 remove 折叠亦安全：
 *    [add X, remove X, update X] → [remove X, rebuild X]，删后重建语义正确）。
 * 3. **remove 不参与折叠**：同实体 remove→rebuild 是两个真实变更，按时间序
 *    先后各执行一次才是正确终态。
 *
 * ## op 顺序语义（为什么不做"add/update 先于 remove"的全局排序）
 *
 * 输入（到达）顺序即磁盘写盘的时间序，而磁盘是唯一事实源：
 * - **同实体序列必须保序**：[remove X, rebuild X]（删除后重建）若被重排为
 *   [rebuild X, remove X] 会得到"节点被删"的错误终态；保序执行自然正确。
 * - **跨实体无正确性依赖**：每条 rebuild 经 importV2ResourceToCanvas 自带依赖
 *   处理（约束导入内部 ensureSchemaNode），不依赖同批其他实体的先后；remove 走
 *   nodeOps.deleteNode 级联清理，同样自洽。
 * 因此保序（稳定排序都无需）即可，任何全局重排反而会破坏同实体时间序。
 *
 * @param envelopes 已通过 parseChangeSetEnvelope 校验的信封列表（时间序）
 */
export function planFromChangeSet(envelopes: ChangeSetEnvelope[]): ReconcilePlan {
  // instructionId 末见去重：Map 迭代序即插入序，delete+set 把后到条目移到末尾
  const byInstructionId = new Map<string, ChangeSetEnvelope>()
  for (const env of envelopes) {
    byInstructionId.delete(env.instructionId)
    byInstructionId.set(env.instructionId, env)
  }
  const deduped = [...byInstructionId.values()]

  // 每实体最后一次 rebuild（add/update）出现的位置——折叠后仅保留该处
  const lastRebuildIdxByEntity = new Map<string, number>()
  deduped.forEach((env, idx) => {
    if (env.op !== 'remove') lastRebuildIdxByEntity.set(env.entityId, idx)
  })

  const ops: ReconcilePlanOp[] = deduped
    .filter((env, idx) => env.op === 'remove' || lastRebuildIdxByEntity.get(env.entityId) === idx)
    .map((env) => ({
      instructionId: env.instructionId,
      op: (env.op === 'remove' ? 'remove' : 'rebuild') as ReconcilePlanOp['op'],
      kind: env.kind,
      entityId: env.entityId,
      filePath: env.filePath,
    }))

  return { ops }
}

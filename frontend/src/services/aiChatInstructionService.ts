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
 * @fileoverview AI 聊天前端指令入口（v2 变更集对账）：把 SSE/快照收到的原始
 * 指令解析为变更集信封并送入画布对账串行队列。
 *
 * v2 契约（docs/contracts/frontend-instructions-v2.md）：指令只声明"哪个磁盘实体
 * 发生了什么变化"，不携带实体数据；画布同步统一走"磁盘重读重建"（文件唯一事实源），
 * 旧的 actionType 镜像 handler 链路已下线。
 */

import { logger } from '@/core/utils/logger'
import { parseChangeSetEnvelope } from './canvasReconcile/envelope'
import type { ReconcileOutcome } from './canvasReconcile/executor'
import { getReconcileQueue } from './canvasReconcile/reconcileQueue'

export { parseChangeSetEnvelope } from './canvasReconcile/envelope'
export type { ChangeSetEnvelope, ChangeSetKind, ChangeSetOp } from './canvasReconcile/envelope'
export type { ReconcileOutcome, ReconcileFailure } from './canvasReconcile/executor'

/**
 * 把原始指令数组（SSE 事件 instruction / completed 快照 frontend_instructions）
 * 解析为信封并批量入队。
 *
 * 非法形状（契约破坏/未知字段漂移）记日志丢弃，不进失败清单——无法定位实体的
 * 条目报错只会制造噪音。返回 null 表示本批没有合法信封（调用方可跳过聚合）。
 *
 * @param instructions 原始指令对象数组（unknown，来自 SSE data）
 * @returns 入队批次的执行结果 Promise；null 表示无可执行内容
 */
export function processFrontendInstructions(
  instructions: unknown[]
): Promise<ReconcileOutcome> | null {
  if (!Array.isArray(instructions) || instructions.length === 0) return null

  const envelopes = []
  for (const raw of instructions) {
    const envelope = parseChangeSetEnvelope(raw)
    if (!envelope) {
      logger.warn('[AI Chat] 非法指令形状（应为 v2 变更集信封），已丢弃:', raw)
      continue
    }
    envelopes.push(envelope)
  }
  if (envelopes.length === 0) return null

  return getReconcileQueue().enqueueChangeSet(envelopes)
}

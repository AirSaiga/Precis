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
 * 模板展开后置关系同步钩子
 *
 * 模板展开走 addNodes + addEdges 直通路径，绕过了 useConnections.onConnect 中的
 * syncOnConnect 调用，不会自动建立 parent/children/outputPortConnected 关系。
 *
 * 本 handler 在所有节点类型专属逻辑执行完后，统一调用 reconcileAll 重建关系。
 *
 * 实现要点：
 *   - 使用 priority 200（最低），确保所有数据计算 / 校验完成后才执行
 *   - match() 永远返回 true（任意 dagNode 都会触发）
 *   - 通过 module 级布尔标志确保每轮展开只调用一次 reconcileAll
 */
import { registerTemplateExpandHandler } from '../registryCore'

let reconciledThisRound = false

/** 重置本轮状态（在 orchestrator 每次调用前重置） */
export function resetRelationshipSyncRound(): void {
  reconciledThisRound = false
}

registerTemplateExpandHandler({
  priority: 200,
  match: () => true,
  execute: async (_dagNode, ctx) => {
    if (reconciledThisRound) return
    reconciledThisRound = true
    if (!ctx.reconcileAll) return
    await ctx.reconcileAll()
  },
})

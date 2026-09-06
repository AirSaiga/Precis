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
 * TransformOutput 输出节点断开连接处理器
 *
 * 处理 transform → transformOutput 断开的清理：
 * - 重置父级 Transform 引用
 * - 从 Transform 节点的 outputNodeIds 中移除当前节点
 */
import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 70,
  match: (_edge, _source, target) => target.type === 'transformOutput',
  cleanup: (edge, source, target, ctx) => {
    const data = (target.data || {}) as Record<string, unknown>
    ctx.updateNodeData(target.id, {
      ...data,
      parentTransformId: undefined,
      saveState: 'draft',
    })

    // 清理 Transform 源节点的 outputNodeIds
    if (source && source.type === 'transform') {
      const sourceData = (source.data || {}) as Record<string, unknown>
      const outputNodeIds = (sourceData.outputNodeIds || []) as string[]
      const nextIds = outputNodeIds.filter((id) => id !== target.id)
      if (nextIds.length !== outputNodeIds.length) {
        ctx.updateNodeData(source.id, {
          ...sourceData,
          outputNodeIds: nextIds,
          saveState: 'draft',
        })
      }
    }
  },
})

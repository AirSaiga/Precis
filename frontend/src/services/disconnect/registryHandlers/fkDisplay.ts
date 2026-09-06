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
 * FK 展示边断开清理（priority 10）
 *
 * 处理 edge.data.kind === 'fkDisplay' 的边（FK 节点 → 目标 Schema）。
 * 由于 find() 是 first-match，priority 10 确保 fkDisplay 边优先于
 * fkColumn（priority 20）匹配，避免两者重叠时重复清理。
 */
import { registerDisconnectHandler } from '../registryCore'

registerDisconnectHandler({
  priority: 10,
  match: (edge) => edge.data?.kind === 'fkDisplay' && !!edge.data?.fkNodeId,
  cleanup: (edge, source, target, ctx) => {
    const fkNode = ctx.nodes.value.find((n) => n.id === edge.data.fkNodeId)
    if (!fkNode) return

    const fkData = (fkNode.data || {}) as Record<string, unknown>
    const config = (fkData.config || {}) as Record<string, unknown>

    ctx.updateNodeData(fkNode.id, {
      ...fkData,
      targetTable: undefined,
      targetRef: undefined,
      targetColumn: undefined,
      config: {
        ...config,
        ruleType: (config.ruleType as 'EXIST_IN' | 'REFERENCE_FROM') || 'EXIST_IN',
        targetNodeId: undefined,
        targetColumn: undefined,
      },
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
      saveState: 'draft',
    })
  },
})

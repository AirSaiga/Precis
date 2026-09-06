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
 * @file useCurrentStreaming.ts
 * @description 从消息列表中提取当前流式消息的 composable
 *
 * 复用原 AgentLayout.vue 的内联 computed 逻辑：倒序查找最后一条
 * role==='assistant' 且 streaming 非空的消息，返回其 streaming 状态。
 *
 * 抽取目的：AppStatusBar（IDE 模式共享状态栏）也需要显示 AI 状态，
 * 避免在 AgentLayout 和 AppStatusBar 两处重复同一查找逻辑。
 */

import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { ChatMessage } from '@/stores/aiChatStore'
import type { StreamingMessage } from '@/composables/shared/useStreamingMessage'

/**
 * 从消息列表中提取当前流式状态
 *
 * @param messages - 消息列表获取函数（适配 Pinia store 解包后的响应式数组）
 * @returns 当前流式状态（无活动时为 null）
 */
export function useCurrentStreaming(
  messages: () => ChatMessage[]
): ComputedRef<StreamingMessage | null> {
  return computed(() => {
    const list = messages()
    for (let i = list.length - 1; i >= 0; i--) {
      const msg = list[i]
      if (msg && msg.role === 'assistant' && msg.streaming) {
        return msg.streaming
      }
    }
    return null
  })
}

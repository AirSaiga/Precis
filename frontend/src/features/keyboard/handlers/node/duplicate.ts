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
 * @file duplicate.ts
 * @description 节点复制处理器
 *
 * 功能概述：
 * - 复制当前选中的单个节点
 * - 返回复制成功或失败状态
 */

import { useGraphStore } from '@/stores/graphStore'

export async function duplicateNode(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  if (!graphStore.selectedNodeId) {
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  const node = graphStore.nodes.find((n) => n.id === graphStore.selectedNodeId)
  if (!node) {
    return { success: false, message: 'shortcuts.feedback.notFound' }
  }

  const newNodeId = await graphStore.duplicateSelectedNode()

  if (newNodeId) {
    return { success: true, message: 'shortcuts.feedback.copied' }
  }

  return { success: false, message: 'shortcuts.feedback.failed' }
}

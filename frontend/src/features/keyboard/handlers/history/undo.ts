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
 * @file undo.ts
 * @description 撤销操作处理器
 *
 * 功能概述：
 * - 检查撤销栈状态
 * - 执行撤销操作并返回结果提示
 */

import { useGraphStore } from '@/stores/graphStore'

export async function undo(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  const canUndo = graphStore.undoStack.length > 0
  if (!canUndo) {
    return { success: false, message: 'shortcuts.feedback.nothingToUndo' }
  }

  await graphStore.undo()
  return { success: true, message: 'shortcuts.feedback.undone' }
}

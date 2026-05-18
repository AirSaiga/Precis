/**
 * @file redo.ts
 * @description 重做操作处理器
 *
 * 功能概述：
 * - 检查重做栈状态
 * - 执行重做操作并返回结果提示
 */

import { useGraphStore } from '@/stores/graphStore'

export async function redo(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()
  
  const canRedo = graphStore.redoStack.length > 0
  if (!canRedo) {
    return { success: false, message: 'shortcuts.feedback.nothingToRedo' }
  }

  await graphStore.redo()
  return { success: true, message: 'shortcuts.feedback.redone' }
}

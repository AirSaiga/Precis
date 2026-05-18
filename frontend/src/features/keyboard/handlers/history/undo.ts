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

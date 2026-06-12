/**
 * @file move.ts
 * @description 节点移动处理器
 *
 * 功能概述：
 * - 按指定方向和像素值移动选中节点
 * - 全选所有节点（selectAllNodes）
 */

import { useGraphStore } from '@/stores/graphStore'

export async function moveNode(
  direction: 'up' | 'down' | 'left' | 'right',
  pixel: number = 10
): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  if (!graphStore.selectedNodeId) {
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  const deltaX = direction === 'left' ? -pixel : direction === 'right' ? pixel : 0
  const deltaY = direction === 'up' ? -pixel : direction === 'down' ? pixel : 0

  graphStore.moveSelectedNode(deltaX, deltaY)
  return { success: true, message: 'shortcuts.feedback.moved' }
}

export async function selectAllNodes(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()
  graphStore.selectAllNodes()
  return { success: true, message: 'shortcuts.feedback.selected' }
}

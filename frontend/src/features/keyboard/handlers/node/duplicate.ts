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

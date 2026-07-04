/**
 * @file delete.ts
 * @description 节点删除处理器
 *
 * 功能概述：
 * - 单节点或批量删除选中节点
 * - 过滤保护项目根节点
 * - 返回删除结果与数量提示
 */

import { useGraphStore } from '@/stores/graphStore'

export async function deleteNode(): Promise<{
  success: boolean
  message?: string
  count?: number
}> {
  const graphStore = useGraphStore()

  const selectedNodeIds = graphStore.selectedNodeIds

  if (selectedNodeIds.length === 0) {
    if (!graphStore.selectedNodeId) {
      return { success: false, message: 'shortcuts.feedback.notSelected' }
    }
  }

  let idsToDelete =
    graphStore.selectedNodeIds.length > 0
      ? [...graphStore.selectedNodeIds]
      : graphStore.selectedNodeId
        ? [graphStore.selectedNodeId]
        : []

  if (idsToDelete.length === 0) {
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  // 过滤掉项目根节点，避免删除操作被完全阻塞
  idsToDelete = idsToDelete.filter((id) => {
    const node = graphStore.nodes.find((n) => n.id === id)
    return node?.type !== 'projectRoot'
  })

  // 如果过滤后没有剩余节点，说明只选中了项目根节点，此时才提示无法删除
  if (idsToDelete.length === 0) {
    return { success: false, message: 'shortcuts.feedback.cannotDeleteProjectRoot' }
  }

  if (idsToDelete.length === 1) {
    const id = idsToDelete[0]
    if (id) {
      await graphStore.deleteNode(id)
    }
    return { success: true, message: 'shortcuts.feedback.deleted', count: 1 }
  } else {
    graphStore.deleteNodes(idsToDelete)
    return {
      success: true,
      message: 'shortcuts.feedback.deletedMultiple',
      count: idsToDelete.length,
    }
  }
}

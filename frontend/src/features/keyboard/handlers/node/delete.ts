/**
 * @file delete.ts
 * @description 节点删除处理器
 *
 * 功能概述：
 * - 单节点或批量删除选中节点
 * - 过滤保护项目根节点
 * - 多节点批量删除需用户二次确认（防误删）
 * - 返回删除结果与数量提示
 */

import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import { i18n } from '@/i18n'

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

  // 多节点批量删除属高危操作，二次确认；单节点删除可依赖 IME/pane-click 守卫与 undo 兜底
  if (idsToDelete.length > 1) {
    const { showConfirm } = useGlobalConfirm()
    const t = i18n.global.t
    const confirmed = await showConfirm({
      type: 'warning',
      message: t('shortcuts.feedback.confirmDeleteMultiple', { count: idsToDelete.length }),
    })
    if (!confirmed) {
      return { success: false, message: 'shortcuts.feedback.deleteCancelled' }
    }
  }

  if (idsToDelete.length === 1) {
    const id = idsToDelete[0]
    if (id) {
      await graphStore.deleteNode(id)
    }
    return { success: true, message: 'shortcuts.feedback.deleted', count: 1 }
  } else {
    await graphStore.deleteNodes(idsToDelete)
    return {
      success: true,
      message: 'shortcuts.feedback.deletedMultiple',
      count: idsToDelete.length,
    }
  }
}

/**
 * @file copyCutPaste.ts
 * @description 节点复制/剪切/粘贴处理器
 *
 * 功能概述：
 * - 复制选中节点（copyNode）
 * - 剪切选中节点（cutNode）
 * - 粘贴节点（pasteNode）
 */

import { useGraphStore } from '@/stores/graphStore'

/**
 * 复制当前选中的节点
 * 将选中节点复制到内部剪贴板，供后续粘贴使用
 * @returns 操作结果对象
 *   - success: 是否复制成功
 *   - message: 国际化消息键，成功时为 'shortcuts.feedback.copied'，失败时为 'shortcuts.feedback.notSelected'
 */
export async function copyNode(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  if (!graphStore.selectedNodeId && graphStore.selectedNodeIds.length === 0) {
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  graphStore.copySelectedNodes()
  return { success: true, message: 'shortcuts.feedback.copied' }
}

/**
 * 剪切当前选中的节点
 * 将选中节点从画布移除并复制到内部剪贴板，供后续粘贴使用
 * @returns 操作结果对象
 *   - success: 是否剪切成功
 *   - message: 国际化消息键，成功时为 'shortcuts.feedback.cut'，失败时为 'shortcuts.feedback.notSelected'
 */
export async function cutNode(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  if (!graphStore.selectedNodeId && graphStore.selectedNodeIds.length === 0) {
    return { success: false, message: 'shortcuts.feedback.notSelected' }
  }

  await graphStore.cutSelectedNodes()
  return { success: true, message: 'shortcuts.feedback.cut' }
}

/**
 * 粘贴剪贴板中的节点
 * 将之前复制或剪切的节点粘贴到画布上
 * @returns 操作结果对象
 *   - success: 是否粘贴成功
 *   - message: 国际化消息键，成功时为 'shortcuts.feedback.pasted'
 */
export async function pasteNode(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()

  // 调用 graphStore 的方法从剪贴板粘贴节点到画布
  await graphStore.pasteNodes()
  return { success: true, message: 'shortcuts.feedback.pasted' }
}

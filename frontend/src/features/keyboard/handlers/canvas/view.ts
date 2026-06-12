/**
 * @file view.ts
 * @description 画布视图操作处理器
 *
 * 功能概述：
 * - 自适应视图（fitView）
 * - 切换迷你地图（toggleMinimap）
 * - 居中视图（centerView）
 * - 聚焦根节点（focusToProjectRoot）
 */

import { useCanvasStore } from '@/stores/canvasStore'
import { useGraphStore } from '@/stores/graphStore'

export async function fitView(): Promise<{ success: boolean; message?: string }> {
  const canvasStore = useCanvasStore()
  canvasStore.fitView()
  return { success: true, message: 'shortcuts.feedback.fitView' }
}

export async function toggleMinimap(): Promise<{ success: boolean; message?: string }> {
  const canvasStore = useCanvasStore()
  canvasStore.toggleMinimap()
  return { success: true, message: 'shortcuts.feedback.minimapToggled' }
}

export async function centerView(): Promise<{ success: boolean; message?: string }> {
  const canvasStore = useCanvasStore()
  canvasStore.centerView()
  return { success: true, message: 'shortcuts.feedback.centered' }
}

export async function focusToProjectRoot(): Promise<{ success: boolean; message?: string }> {
  const graphStore = useGraphStore()
  const projectNode = graphStore.nodes.find((n) => n.type === 'projectRoot')
  if (projectNode) {
    if (
      typeof window !== 'undefined' &&
      (window as unknown as { __focusToProjectRoot?: () => void }).__focusToProjectRoot
    ) {
      ;(window as unknown as { __focusToProjectRoot?: () => void }).__focusToProjectRoot!()
    }
    return { success: true, message: 'shortcuts.feedback.focusProject' }
  }
  return { success: false, message: 'shortcuts.feedback.notFound' }
}

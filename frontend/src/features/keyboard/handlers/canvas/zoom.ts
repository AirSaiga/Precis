/**
 * @file zoom.ts
 * @description 画布缩放操作处理器
 *
 * 功能概述：
 * - 放大画布（zoomIn）
 * - 缩小画布（zoomOut）
 * - 重置缩放（resetZoom）
 */

import { useCanvasStore } from '@/stores/canvasStore'

export async function zoomIn(): Promise<{ success: boolean; message?: string }> {
  const canvasStore = useCanvasStore()
  canvasStore.zoomIn()
  return { success: true, message: 'shortcuts.feedback.zoomedIn' }
}

export async function zoomOut(): Promise<{ success: boolean; message?: string }> {
  const canvasStore = useCanvasStore()
  canvasStore.zoomOut()
  return { success: true, message: 'shortcuts.feedback.zoomedOut' }
}

export async function resetZoom(): Promise<{ success: boolean; message?: string }> {
  const canvasStore = useCanvasStore()
  canvasStore.resetZoom()
  return { success: true, message: 'shortcuts.feedback.zoomReset' }
}

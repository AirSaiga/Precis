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

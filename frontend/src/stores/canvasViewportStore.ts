/**
 * @file canvasViewportStore.ts
 * @description 画布视口（pan/zoom）会话内持久化
 *
 * 职责：
 * - 缓存当前画布视口状态 { x, y, zoom }
 * - NodeCanvas 销毁前（如 IDE ↔ Agent 模式切换）写入，新 NodeCanvas 挂载后读取恢复
 *
 * 范围：仅会话内持久（内存），不跨 reload。
 * 跨会话持久化需接活 ProjectViewV2.viewport 死字段（v2ProjectBuilder + load.ts），留作后续。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

/** 视口状态 */
export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

/** 默认视口（与 NodeCanvas.vue 的 default-viewport 一致） */
export const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 0.8 }

export const useCanvasViewportStore = defineStore('canvasViewport', () => {
  /** 当前缓存的视口状态 */
  const viewport = ref<CanvasViewport>({ ...DEFAULT_VIEWPORT })

  /** 是否已被用户修改过（用于区分"默认值"和"用户设置的值"） */
  const isCustomized = ref(false)

  /** 写入视口状态（用户拖动/缩放后调用） */
  function setViewport(v: CanvasViewport): void {
    viewport.value = { ...v }
    isCustomized.value = true
  }

  /** 重置为默认视口 */
  function reset(): void {
    viewport.value = { ...DEFAULT_VIEWPORT }
    isCustomized.value = false
  }

  return {
    viewport,
    isCustomized,
    setViewport,
    reset,
  }
})

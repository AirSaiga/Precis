/**
 * @file appModeStore.ts
 * @description 应用模式状态管理
 *
 * 职责：
 * - 管理 IDE / Agent 双模式切换状态
 * - 提供 setMode / toggleMode 操作
 * - 通过事件总线广播模式变更，供布局层感知切换
 *
 * 命名说明：本 Store 的 `mode` 与 aiChatStore 的 `agentMode`（AI 深度模式布尔值）
 * 是两个完全独立的概念，避免命名冲突。
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

import { useAiChatStore } from '@/stores/aiChatStore'
import { logger } from '@/core/utils/logger'

/** 应用模式类型 */
export type AppMode = 'ide' | 'agent'

/**
 * 应用模式 Store 工厂函数
 *
 * 使用 Pinia Setup Store 模式，提供 IDE / Agent 双模式切换。
 * - IDE 模式：现有的手动操作画布（ActivityBar + Sidebar + Canvas + Inspector）
 * - Agent 模式：AI 全自动驱动画布（AI 面板 + 画布，隐藏工具箱）
 */
export const useAppModeStore = defineStore('appMode', () => {
  // --- 核心状态 ---
  /** 当前应用模式，默认 IDE 模式 */
  const mode = ref<AppMode>('ide')

  // --- 计算属性 ---
  /** 是否处于 Agent 模式 */
  const isAgentMode = computed(() => mode.value === 'agent')

  // --- Actions ---

  /**
   * 切换到指定模式（异步）
   *
   * 切换前主动清理 AI 任务：中止进行中的流式对话 + 等待飞行指令落定，
   * 避免 NodeCanvas 重建窗口期内指令命中已销毁的 vueFlowApi 单例。
   * 这是"主动清理"层；即使清理有遗漏，飞行指令也由 guardCanvasOp 静默降级兜底。
   *
   * 调用方（如 ModeToggle @click）无需 await——async 函数返回 Promise 自动处理。
   *
   * @param next - 目标模式：'ide' 或 'agent'
   */
  async function setMode(next: AppMode) {
    if (mode.value === next) return
    // 切换前中止 AI 任务并等待飞行指令落定
    try {
      const aiChatStore = useAiChatStore()
      if (aiChatStore.loading) {
        await aiChatStore.cancelSendMessage()
      }
      await aiChatStore.awaitPendingInstructions()
    } catch (e) {
      // 清理失败不阻塞切换——guardCanvasOp 会兜底降级
      logger.warn('[appModeStore] 切换前 AI 任务清理失败，继续切换:', e)
    }
    mode.value = next
  }

  /** 在 IDE / Agent 模式之间切换 */
  function toggleMode() {
    setMode(mode.value === 'ide' ? 'agent' : 'ide')
  }

  // --- 导出 ---
  return {
    mode,
    isAgentMode,
    setMode,
    toggleMode,
  }
})

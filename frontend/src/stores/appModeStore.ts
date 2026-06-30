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

import { eventBus } from '@/core/eventBus'

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
   * 切换到指定模式
   *
   * 仅当模式真正改变时才写入状态并广播事件，避免无谓的重渲染。
   *
   * @param next - 目标模式：'ide' 或 'agent'
   */
  function setMode(next: AppMode) {
    if (mode.value === next) return
    mode.value = next
    // 广播模式变更事件，供布局层（App.vue）和需要感知模式切换的组件订阅
    eventBus.emit('modechange', { mode: next })
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

/**
 * @file aiConfigGeneratorStore.ts
 * @description AI 配置生成器 Pinia Store（轻量编排层）
 *
 * 功能概述:
 * - 管理 Modal 可见性（替换原 DOM CustomEvent 通信）
 * - 管理 AI Provider 状态
 * - 管理生成选项
 * - 提供 open()/close()/resetAllState() 编排接口
 *
 * 架构设计:
 * - 轻量编排 Store：只持有 visible、provider、options 等顶层状态
 * - 生成任务、文件选择、冲突处理等逻辑保留在独立 composable 中
 * - Store 的 resetAllState() 在各 composable 注入后委托其清理
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { logger } from '@/core/utils/logger'
import { getActiveCloudAIProvider } from '@/api/aiApi'
import { createDefaultOptions } from '../services/generationOptions'
import type { AiGenerateV2ConfigOptions } from '@/types/ai'
import type { CloudAIProviderResponse } from '@/types/ai'

export const useAiConfigGeneratorStore = defineStore('aiConfigGenerator', () => {
  // ==================== 可见性 ====================
  const visible = ref(false)

  // ==================== Provider ====================
  const activeProvider = ref<CloudAIProviderResponse | null>(null)
  const providerLoaded = ref(false)

  const loadActiveProvider = async () => {
    providerLoaded.value = false
    try {
      activeProvider.value = await getActiveCloudAIProvider()
    } catch (e) {
      logger.error('Failed to load active provider', e)
      activeProvider.value = null
    } finally {
      providerLoaded.value = true
    }
  }

  // ==================== 选项（内部使用，不再暴露给 UI 编辑） ====================
  const options = ref<AiGenerateV2ConfigOptions>(createDefaultOptions())

  // ==================== 重置钩子 ====================
  /** 由 Modal 组件注册的清理回调列表 */
  const _resetHooks: Array<() => void> = []

  /**
   * 注册重置钩子（由 Modal 组件在初始化各 composable 时调用）
   * 每个 composable 可以注册自己的清理逻辑
   */
  const registerResetHook = (hook: () => void) => {
    _resetHooks.push(hook)
  }

  // ==================== 核心操作 ====================

  /**
   * 打开 AI 配置生成器
   */
  const open = () => {
    resetAllState()
    visible.value = true
    void loadActiveProvider()
  }

  /**
   * 关闭 AI 配置生成器
   */
  const close = () => {
    visible.value = false
    // 执行清理钩子（停止轮询、计时器等）
    for (const hook of _resetHooks) {
      hook()
    }
  }

  /**
   * 重置所有状态到初始值
   */
  const resetAllState = () => {
    options.value = createDefaultOptions()
    activeProvider.value = null
    providerLoaded.value = false
  }

  return {
    // 可见性
    visible,
    // Provider
    activeProvider,
    providerLoaded,
    loadActiveProvider,
    // 选项（内部）
    options,
    // 核心操作
    open,
    close,
    resetAllState,
    // 钩子注册
    registerResetHook,
  }
})

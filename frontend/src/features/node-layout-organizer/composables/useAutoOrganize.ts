/**
 * @file useAutoOrganize.ts
 * @description 自动布局组织组合式函数
 *
 * 功能概述：
 * - 监听节点与连接变化，自动触发整理
 * - 支持防抖配置与触发事件自定义
 * - 与设置面板状态同步
 * - 支持立即整理与配置更新
 */
import { logger } from '@/core/utils/logger'
import { watch, type WatchStopHandle, ref, readonly } from 'vue'
import { useNodeOrganizer } from './useNodeOrganizer'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGraphStore } from '@/stores/graphStore'
import type { OrganizeOptions } from '../types'

export function useAutoOrganize() {
  const settingsStore = useSettingsStore()
  const graphStore = useGraphStore()
  const { organizeNodes, organizeOptions } = useNodeOrganizer()

  const isAutoOrganizeEnabled = ref(false)
  const autoOrganizeDebounceMs = ref(1000)
  const triggerEvents = ref<Array<'nodeAdd' | 'nodeDelete' | 'nodeMove' | 'connectionChange'>>([
    'nodeAdd',
    'nodeDelete',
    'connectionChange',
  ])

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let watchStopHandle: WatchStopHandle | null = null

  /**
   * 启动自动整理
   */
  function startAutoOrganize(
    options?: Partial<{
      debounceMs: number
      triggerOn: Array<'nodeAdd' | 'nodeDelete' | 'nodeMove' | 'connectionChange'>
    }>
  ): void {
    if (options?.debounceMs !== undefined) {
      autoOrganizeDebounceMs.value = options.debounceMs
    }
    if (options?.triggerOn !== undefined) {
      triggerEvents.value = options.triggerOn
    }

    isAutoOrganizeEnabled.value = true
    setupWatchers()

    logger.debug('[useAutoOrganize] 自动整理已启动', {
      debounceMs: autoOrganizeDebounceMs.value,
      triggers: triggerEvents.value,
    })
  }

  /**
   * 停止自动整理
   */
  function stopAutoOrganize(): void {
    isAutoOrganizeEnabled.value = false
    clearWatchers()
    clearDebounceTimer()

    logger.debug('[useAutoOrganize] 自动整理已停止')
  }

  /**
   * 切换自动整理状态
   */
  function toggleAutoOrganize(
    options?: Partial<{
      debounceMs: number
      triggerOn: Array<'nodeAdd' | 'nodeDelete' | 'nodeMove' | 'connectionChange'>
    }>
  ): void {
    if (isAutoOrganizeEnabled.value) {
      stopAutoOrganize()
    } else {
      startAutoOrganize(options)
    }
  }

  /**
   * 设置监听器
   * 直接监听 graphStore 的节点/边数量变化，而不是 settingsStore 的开关
   */
  function setupWatchers(): void {
    clearWatchers()
    const unwatchers: (() => void)[] = []

    const nodeEventEnabled =
      triggerEvents.value.includes('nodeAdd') || triggerEvents.value.includes('nodeDelete')

    const connectionEventEnabled = triggerEvents.value.includes('connectionChange')

    if (nodeEventEnabled) {
      unwatchers.push(
        watch(
          () => graphStore.nodes.length,
          () => {
            if (isAutoOrganizeEnabled.value) {
              triggerDebouncedOrganize()
            }
          }
        )
      )
    }

    if (connectionEventEnabled) {
      unwatchers.push(
        watch(
          () => graphStore.edges.length,
          () => {
            if (isAutoOrganizeEnabled.value) {
              triggerDebouncedOrganize()
            }
          }
        )
      )
    }

    // 保留对 settingsStore 的监听：当用户在设置面板开启/关闭自动整理时，同步状态
    unwatchers.push(
      watch(
        () => settingsStore.autoOrganizeOnNodeAdd,
        (enabled) => {
          if (enabled && !isAutoOrganizeEnabled.value) {
            startAutoOrganize()
          } else if (!enabled && isAutoOrganizeEnabled.value) {
            stopAutoOrganize()
          }
        }
      )
    )

    watchStopHandle = () => {
      unwatchers.forEach((unwatch) => unwatch())
      unwatchers.length = 0
    }
  }

  /**
   * 清除监听器
   */
  function clearWatchers(): void {
    if (watchStopHandle) {
      watchStopHandle()
      watchStopHandle = null
    }
  }

  /**
   * 触发防抖整理
   */
  function triggerDebouncedOrganize(): void {
    clearDebounceTimer()

    debounceTimer = setTimeout(() => {
      if (isAutoOrganizeEnabled.value) {
        organizeNodes()
      }
    }, autoOrganizeDebounceMs.value)
  }

  /**
   * 清除防抖定时器
   */
  function clearDebounceTimer(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  /**
   * 立即触发一次整理（不经过防抖）
   */
  function triggerImmediateOrganize(): void {
    clearDebounceTimer()
    if (isAutoOrganizeEnabled.value) {
      organizeNodes()
    }
  }

  /**
   * 更新配置
   */
  function updateConfig(
    config: Partial<{
      debounceMs: number
      triggerOn: Array<'nodeAdd' | 'nodeDelete' | 'nodeMove' | 'connectionChange'>
    }>
  ): void {
    const wasEnabled = isAutoOrganizeEnabled.value

    if (config.debounceMs !== undefined) {
      autoOrganizeDebounceMs.value = config.debounceMs
    }

    if (config.triggerOn !== undefined) {
      triggerEvents.value = config.triggerOn
    }

    if (wasEnabled && isAutoOrganizeEnabled.value) {
      stopAutoOrganize()
      startAutoOrganize()
    }
  }

  return {
    isAutoOrganizeEnabled: readonly(isAutoOrganizeEnabled),
    autoOrganizeDebounceMs: readonly(autoOrganizeDebounceMs),
    triggerEvents: readonly(triggerEvents),

    startAutoOrganize,
    stopAutoOrganize,
    toggleAutoOrganize,
    triggerImmediateOrganize,
    updateConfig,
  }
}

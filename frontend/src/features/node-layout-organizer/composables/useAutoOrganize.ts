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
 * @file useAutoOrganize.ts
 * @description 自动布局组织组合式函数
 *
 * 功能概述：
 * - 监听节点与连接变化，自动触发整理（防抖）
 * - 三个持久化开关（GeneralSettings.autoOrganizeOnXxx）各自独立生效：
 *   节点添加 / 节点删除 / 连线变化，任一开启即运行
 * - 实例化时按当前持久化设置启动（设置 watcher 只响应变化）
 * - 自动整理关闭整理后取景（编辑中视口频跳不可接受）
 * - 与加载适配（useCanvasLoadAdaptation）互斥：加载完成信号取消待执行的整理
 *
 * 实例化位置约束：必须在 VueFlow 宿主组件（NodeCanvas）setup 内调用——
 * 内部 useNodeOrganizer 依赖 useVueFlow() 的 provide/inject。
 */
import { logger } from '@/core/utils/logger'
import { watch, type WatchStopHandle, ref, readonly, onScopeDispose, getCurrentScope } from 'vue'
import { useNodeOrganizer } from './useNodeOrganizer'
import { useSettingsStore } from '@/stores/settingsStore'
import { useGraphStore } from '@/stores/graphStore'
import { useCanvasStore } from '@/stores/canvasStore'

/** 自动整理支持的触发事件 */
type AutoOrganizeTrigger = 'nodeAdd' | 'nodeDelete' | 'nodeMove' | 'connectionChange'

/** 手动 startAutoOrganize（未显式传 triggerOn 且设置全关）时的默认触发集合 */
const DEFAULT_TRIGGERS: AutoOrganizeTrigger[] = ['nodeAdd', 'nodeDelete', 'connectionChange']

export function useAutoOrganize() {
  const settingsStore = useSettingsStore()
  const graphStore = useGraphStore()
  const canvasStore = useCanvasStore()
  const { organizeNodes } = useNodeOrganizer()

  const isAutoOrganizeEnabled = ref(false)
  const autoOrganizeDebounceMs = ref(1000)
  const triggerEvents = ref<AutoOrganizeTrigger[]>([...DEFAULT_TRIGGERS])

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  /** 图结构 watchers（节点/边数量），stopAutoOrganize 时拆除 */
  let watchStopHandle: WatchStopHandle | null = null
  /**
   * 设置 → 运行状态 的 watcher（监听 GeneralSettings 三开关）。
   * 独立于 watchStopHandle 生命周期：stopAutoOrganize 只停图结构 watchers，
   * 保留本 watcher——否则用户在设置面板重新开启自动整理时将无人响应启动。
   */
  let settingsWatchStopHandle: WatchStopHandle | null = null

  /**
   * 从持久化设置派生触发事件集合。
   *
   * 三个开关各自独立映射进 triggerOn：只开"删除时整理"时，
   * 新增节点不得触发整理（反之亦然）。
   */
  function triggersFromSettings(): AutoOrganizeTrigger[] {
    const triggers: AutoOrganizeTrigger[] = []
    if (settingsStore.autoOrganizeOnNodeAdd) triggers.push('nodeAdd')
    if (settingsStore.autoOrganizeOnNodeDelete) triggers.push('nodeDelete')
    if (settingsStore.autoOrganizeOnConnectionChange) triggers.push('connectionChange')
    return triggers
  }

  /**
   * 启动自动整理
   *
   * @param options.debounceMs 防抖窗口（ms）
   * @param options.triggerOn 触发事件集合；缺省时优先取设置面板三开关派生，
   *   设置全关则回退默认全集（保持手动启用的既有语义）
   */
  function startAutoOrganize(
    options?: Partial<{
      debounceMs: number
      triggerOn: AutoOrganizeTrigger[]
    }>
  ): void {
    if (options?.debounceMs !== undefined) {
      autoOrganizeDebounceMs.value = options.debounceMs
    }
    const derived = triggersFromSettings()
    triggerEvents.value =
      options?.triggerOn ?? (derived.length > 0 ? derived : [...DEFAULT_TRIGGERS])

    isAutoOrganizeEnabled.value = true
    setupWatchers()
    // 设置面板开关 → 启动 的 watcher 独立于图 watchers 注册，stop 后不拆除
    ensureSettingsWatcher()

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
      triggerOn: AutoOrganizeTrigger[]
    }>
  ): void {
    if (isAutoOrganizeEnabled.value) {
      stopAutoOrganize()
    } else {
      startAutoOrganize(options)
    }
  }

  /**
   * 设置三开关 → 运行状态 同步。
   *
   * 任一开关开启即运行（触发集合按设置重新派生并重建图 watchers）；
   * 全部关闭则停止。设置变化与实例化启动共用本入口。
   */
  function syncWithSettings(): void {
    const triggers = triggersFromSettings()
    if (triggers.length === 0) {
      if (isAutoOrganizeEnabled.value) {
        stopAutoOrganize()
      }
      return
    }
    if (isAutoOrganizeEnabled.value) {
      // 已在运行：仅按新触发集合重建图 watchers，不打断防抖窗口
      triggerEvents.value = triggers
      setupWatchers()
    } else {
      startAutoOrganize({ triggerOn: triggers })
    }
  }

  /**
   * 设置监听器
   * 直接监听 graphStore 的节点/边数量变化，而不是 settingsStore 的开关
   */
  function setupWatchers(): void {
    clearWatchers()
    const unwatchers: (() => void)[] = []

    const addEnabled = triggerEvents.value.includes('nodeAdd')
    const deleteEnabled = triggerEvents.value.includes('nodeDelete')

    if (addEnabled || deleteEnabled) {
      unwatchers.push(
        watch(
          () => graphStore.nodes.length,
          (newLength, oldLength) => {
            if (!isAutoOrganizeEnabled.value) return
            // 长度增减区分新增/删除，各自受对应开关控制
            const isAdd = newLength > oldLength
            if ((isAdd && addEnabled) || (!isAdd && deleteEnabled)) {
              triggerDebouncedOrganize()
            }
          }
        )
      )
    }

    if (triggerEvents.value.includes('connectionChange')) {
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

    watchStopHandle = () => {
      unwatchers.forEach((unwatch) => unwatch())
      unwatchers.length = 0
    }
  }

  /**
   * 注册设置面板三开关 watcher（幂等，重复调用只注册一次）。
   *
   * 该 watcher 的生命周期独立于图结构 watchers：用户在设置面板
   * 开启/关闭自动整理时同步启停本组合函数，stopAutoOrganize 不应拆除它，
   * 否则停止后再也无法经设置面板重新启动。
   */
  function ensureSettingsWatcher(): void {
    if (settingsWatchStopHandle) return
    settingsWatchStopHandle = watch(
      () => [
        settingsStore.autoOrganizeOnNodeAdd,
        settingsStore.autoOrganizeOnNodeDelete,
        settingsStore.autoOrganizeOnConnectionChange,
      ],
      () => {
        syncWithSettings()
      }
    )
  }

  /**
   * 清除监听器（仅图结构 watchers；设置面板 watcher 保留，见 ensureSettingsWatcher）
   */
  function clearWatchers(): void {
    if (watchStopHandle) {
      watchStopHandle()
      watchStopHandle = null
    }
  }

  /**
   * 触发防抖整理
   *
   * 自动整理关闭整理后取景（fitViewAfter: false）：编辑过程中每次后台
   * 整理都重设视口会造成视口频跳，用户正在查看的位置被甩走。
   */
  function triggerDebouncedOrganize(): void {
    clearDebounceTimer()

    debounceTimer = setTimeout(() => {
      if (isAutoOrganizeEnabled.value) {
        organizeNodes({ fitViewAfter: false })
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
      organizeNodes({ fitViewAfter: false })
    }
  }

  /**
   * 更新配置
   */
  function updateConfig(
    config: Partial<{
      debounceMs: number
      triggerOn: AutoOrganizeTrigger[]
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

  // ===== 实例化即接管（NodeCanvas setup 内调用一次） =====

  // 按当前持久化设置启动：设置 watcher 只响应变化，不补这步的话
  // 重启应用 / 模式切换销毁重建画布后，已开启的开关不会生效。
  syncWithSettings()
  ensureSettingsWatcher()

  // 卸载无条件清理（资源泄漏纪律）：设置开关被改动后，图 watchers 会经
  // settings watcher 回调在组件 scope 之外重建（孤儿 watcher，组件销毁不
  // 自动回收）；settings watcher 本身也刻意跨 stop/start 存活。布局切换
  // 重挂画布时二者都必须显式停掉，否则在死 VueFlow 实例上继续跑防抖整理。
  // getCurrentScope 守卫：无活跃 scope（测试直接实例化）时跳过注册不告警。
  if (getCurrentScope()) {
    onScopeDispose(() => {
      stopAutoOrganize()
      if (settingsWatchStopHandle) {
        settingsWatchStopHandle()
        settingsWatchStopHandle = null
      }
    })
  }

  // 与加载适配互斥：项目加载/工作区恢复完成（contentLoadedEpoch 变化）时，
  // 取消尚在防抖窗口内的自动整理——加载链路的节点全量替换会误触发，
  // 且与加载适配的自动取景叠加会造成双重布局/视口突跳。
  watch(
    () => canvasStore.contentLoadedEpoch,
    () => {
      clearDebounceTimer()
    }
  )

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

/**
 * @file shortcutStore.ts
 * @description 快捷键状态管理
 *
 * 职责：
 * - 管理用户自定义快捷键配置（启用/禁用状态）
 * - 命令级别的快捷键开关控制
 * - 自定义快捷键绑定
 * - localStorage 持久化
 * - 配置的导入导出
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import {
  type ShortcutUserConfig,
  loadUserConfig,
  saveUserConfig,
  createDefaultConfig,
  exportConfig as exportShortcutConfig,
  importConfig as importShortcutConfig,
} from '@/services/shortcutConfigService'

export type { ShortcutUserConfig } from '@/services/shortcutConfigService'

export const useShortcutStore = defineStore('shortcut', () => {
  /** 启动时从 localStorage 加载用户配置，不存在时由 loadUserConfig 返回默认值 */
  const config = ref<ShortcutUserConfig>(loadUserConfig())

  /**
   * 快捷键总开关（可写 computed）
   *
   * 读取时返回配置中的启用状态，写入时自动持久化到 localStorage。
   */
  const enabled = computed({
    get: () => config.value.enabled,
    set: (value) => {
      config.value.enabled = value
      saveUserConfig(config.value)
    },
  })

  /**
   * 是否在触发快捷键时显示操作反馈
   *
   * 可写 computed，变更时自动持久化。
   */
  const showFeedback = computed({
    get: () => config.value.showFeedback,
    set: (value) => {
      config.value.showFeedback = value
      saveUserConfig(config.value)
    },
  })

  /** 当前被禁用的命令数量 */
  const disabledCount = computed(() => config.value.disabledCommands.length)

  /** 当前已自定义快捷键的命令数量 */
  const customShortcutCount = computed(() => Object.keys(config.value.customShortcuts).length)

  /**
   * 重置所有快捷键配置为默认值
   *
   * 用户在设置面板点击"恢复默认"时调用，
   * 会清除所有自定义绑定和禁用列表。
   */
  function resetToDefaults(): void {
    config.value = createDefaultConfig()
    saveUserConfig(config.value)
  }

  /**
   * 禁用指定命令的快捷键
   *
   * 禁用后该命令不再响应快捷键触发。
   * 已在禁用列表中的命令不会重复添加。
   *
   * @param commandId - 命令唯一标识
   */
  function disableCommand(commandId: string): void {
    if (!config.value.disabledCommands.includes(commandId)) {
      config.value.disabledCommands.push(commandId)
      saveUserConfig(config.value)
    }
  }

  /**
   * 重新启用指定命令的快捷键
   *
   * 从禁用列表中移除该命令，恢复快捷键响应。
   *
   * @param commandId - 命令唯一标识
   */
  function enableCommand(commandId: string): void {
    const index = config.value.disabledCommands.indexOf(commandId)
    if (index > -1) {
      config.value.disabledCommands.splice(index, 1)
      saveUserConfig(config.value)
    }
  }

  /**
   * 检查指定命令是否已被禁用
   *
   * @param commandId - 命令唯一标识
   * @returns 该命令是否处于禁用状态
   */
  function isCommandDisabled(commandId: string): boolean {
    return config.value.disabledCommands.includes(commandId)
  }

  /**
   * 为指定命令设置自定义快捷键
   *
   * 覆盖该命令的默认快捷键绑定。
   *
   * @param commandId - 命令唯一标识
   * @param shortcut - 自定义快捷键组合（key + 修饰键）
   */
  function setCustomShortcut(
    commandId: string,
    shortcut: {
      key: string
      ctrl?: boolean
      meta?: boolean
      shift?: boolean
      alt?: boolean
    }
  ): void {
    config.value.customShortcuts[commandId] = shortcut
    saveUserConfig(config.value)
  }

  /**
   * 删除指定命令的自定义快捷键
   *
   * 删除后该命令将回退到默认快捷键绑定。
   *
   * @param commandId - 命令唯一标识
   */
  function deleteCustomShortcut(commandId: string): void {
    delete config.value.customShortcuts[commandId]
    saveUserConfig(config.value)
  }

  /**
   * 获取指定命令的自定义快捷键
   *
   * @param commandId - 命令唯一标识
   * @returns 自定义快捷键对象，未自定义时返回 undefined
   */
  function getCustomShortcut(commandId: string) {
    return config.value.customShortcuts[commandId]
  }

  /**
   * 导出当前快捷键配置
   *
   * 返回配置的深拷贝，用于备份或分享给其他用户。
   *
   * @returns 快捷键用户配置的副本
   */
  function exportConfig(): ShortcutUserConfig {
    return exportShortcutConfig(config.value)
  }

  /**
   * 导入快捷键配置
   *
   * 导入后自动持久化到 localStorage，立即生效。
   *
   * @param userConfig - 要导入的快捷键配置
   */
  function importConfig(userConfig: ShortcutUserConfig): void {
    config.value = importShortcutConfig(userConfig)
    saveUserConfig(config.value)
  }

  return {
    config,
    enabled,
    showFeedback,
    disabledCount,
    customShortcutCount,
    resetToDefaults,
    disableCommand,
    enableCommand,
    isCommandDisabled,
    setCustomShortcut,
    deleteCustomShortcut,
    getCustomShortcut,
    exportConfig,
    importConfig,
  }
})

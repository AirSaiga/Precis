/**
 * @file useTheme.ts
 * @description 主题管理组合式函数
 *
 * 响应式监听用户设置的主题偏好，并应用到 UI。
 * 支持 'light'、'dark'、'system'、'liquid' 四种模式。
 *
 * 功能概述：
 * - 监听 settingsStore.generalSettings.theme 变化
 * - 当主题为 'system' 时，响应操作系统主题切换事件
 * - 组件卸载时自动清理事件监听器
 *
 * 架构设计：
 * - 组合式函数模式，在组件 setup 中调用
 * - 使用 Vue watch 实现响应式主题切换
 * - 使用 matchMedia 监听系统主题变化
 */

import { onBeforeUnmount, watch } from 'vue'
import { applyThemePreference, getThemeMediaQuery } from '@/core/utils/theme'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * 主题管理组合式函数
 *
 * 响应式监听用户设置的主题偏好，并应用到 UI。
 * 支持 'light'、'dark'、'system'、'liquid' 四种模式。
 *
 * 当主题为 'system' 时，会额外监听操作系统主题变化事件，实现自动切换。
 * 组件卸载时自动清理事件监听器，避免内存泄漏。
 *
 * @example
 * // 在 App.vue 或根组件的 setup 中调用
 * useTheme()
 */
export function useTheme() {
  const settingsStore = useSettingsStore()

  // 监听用户设置的主题变化，立即应用（immediate 确保首次加载也生效）
  watch(
    () => settingsStore.generalSettings.theme,
    (newTheme) => {
      applyThemePreference(newTheme)
    },
    { immediate: true }
  )

  // 获取系统主题媒体查询对象（prefers-color-scheme）
  const mediaQuery = getThemeMediaQuery()

  /**
   * 系统主题变化回调
   *
   * 仅在用户选择 'system' 模式时重新应用主题，避免手动设置的主题被覆盖。
   */
  const handleSystemThemeChange = () => {
    if (settingsStore.generalSettings.theme === 'system') {
      applyThemePreference('system')
    }
  }

  // 注册系统主题变化监听
  if (mediaQuery) {
    mediaQuery.addEventListener('change', handleSystemThemeChange)
  }

  // 组件卸载时清理监听器，防止内存泄漏
  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', handleSystemThemeChange)
  })
}

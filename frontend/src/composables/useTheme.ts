/**
 * @file useTheme.ts
 * @description 主题管理组合式函数
 *
 * 响应式监听用户设置的主题偏好，并应用到 UI。
 * 支持 'light'、'dark'、'system' 三种模式。
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

export function useTheme() {
  const settingsStore = useSettingsStore()

  watch(
    () => settingsStore.generalSettings.theme,
    (newTheme) => {
      applyThemePreference(newTheme)
    },
    { immediate: true }
  )

  const mediaQuery = getThemeMediaQuery()
  const handleSystemThemeChange = () => {
    if (settingsStore.generalSettings.theme === 'system') {
      applyThemePreference('system')
    }
  }

  if (mediaQuery) {
    mediaQuery.addEventListener('change', handleSystemThemeChange)
  }

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', handleSystemThemeChange)
  })
}

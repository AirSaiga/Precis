/**
 * @file settingsNavStore.ts
 * @description 设置面板导航状态管理（UX 重做版）
 *
 * 职责：
 * - 面板可见性控制（打开/关闭/切换）
 * - 导航项激活状态
 * - 搜索关键词
 * - Tab 兼容层（旧代码使用 Tab 枚举，新代码使用导航项 ID）
 *
 * 变更（UX 重做）：
 * - 移除分组展开/折叠状态（导航改为扁平不可折叠列表）
 * - 简化搜索过滤逻辑
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SettingsTab } from '@/types/settings'
import { NAV_ITEM_TO_TAB_MAP, TAB_TO_NAV_ITEM_MAP } from '@/types/settings'

/**
 * 设置面板导航 Store 工厂函数
 */
export const useSettingsNavStore = defineStore('settingsNav', () => {
  // ===== 面板可见性 =====
  const visible = ref(false)

  // ===== 导航状态 =====
  // 默认选中"通用"导航项
  const activeNavItem = ref('general')
  // 搜索关键词，用于过滤导航项列表
  const searchQuery = ref('')

  // ===== 兼容层 =====
  // 旧代码使用 Tab 枚举导航，新代码使用导航项 ID。
  // activeTab 通过映射表从导航项 ID 转换而来，保持向后兼容。
  const activeTab = computed<SettingsTab>(() => {
    return NAV_ITEM_TO_TAB_MAP[activeNavItem.value] || 'general'
  })

  // ===== 导航控制 =====

  /**
   * 打开设置面板并导航到指定 Tab
   *
   * @param tab - 目标 Tab 标识，默认 'general'
   */
  function open(tab: SettingsTab = 'general'): void {
    activeNavItem.value = TAB_TO_NAV_ITEM_MAP[tab] || tab
    visible.value = true
  }

  /**
   * 关闭设置面板
   *
   * 关闭时清空搜索关键词，避免下次打开时残留搜索状态。
   */
  function close(): void {
    visible.value = false
    searchQuery.value = ''
  }

  /**
   * 切换设置面板的可见性
   *
   * @param tab - 打开时导航到的 Tab，默认使用当前 activeTab
   */
  function toggle(tab?: SettingsTab): void {
    if (visible.value) {
      close()
      return
    }
    open(tab ?? activeTab.value)
  }

  /**
   * 设置当前激活的导航项
   *
   * @param itemId - 导航项 ID
   */
  function setActiveNavItem(itemId: string): void {
    activeNavItem.value = itemId
  }

  /**
   * 通过 Tab 标识设置当前激活的导航项
   *
   * @param tab - Tab 标识
   */
  function setActiveTab(tab: SettingsTab): void {
    activeNavItem.value = TAB_TO_NAV_ITEM_MAP[tab] || tab
  }

  /** 面板是否处于打开状态（visible 的别名，语义更清晰） */
  const isOpen = computed(() => visible.value)

  // --- 导出 ---
  return {
    visible,
    isOpen,
    activeNavItem,
    searchQuery,
    activeTab,
    open,
    close,
    toggle,
    setActiveNavItem,
    setActiveTab,
  }
})

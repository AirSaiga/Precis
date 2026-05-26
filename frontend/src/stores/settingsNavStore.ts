/**
 * @file settingsNavStore.ts
 * @description 设置面板导航状态管理
 *
 * 职责：
 * - 面板可见性控制（打开/关闭/切换）
 * - 导航项/分组展开状态
 * - 搜索关键词
 * - Tab 兼容层（旧代码使用 Tab 枚举，新代码使用导航项 ID）
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { SettingsTab } from '@/types/settings'
import { NAV_ITEM_TO_TAB_MAP, TAB_TO_NAV_ITEM_MAP } from '@/types/settings'

/**
 * 设置面板导航 Store 工厂函数
 *
 * 职责：
 * - 控制设置面板的打开/关闭/切换
 * - 管理导航项激活状态与分组展开状态
 * - 维护搜索关键词
 * - 提供 Tab 兼容层（旧代码使用 Tab 枚举，新代码使用导航项 ID）
 */
export const useSettingsNavStore = defineStore('settingsNav', () => {
  // ===== 面板可见性 =====
  const visible = ref(false)

  // ===== 导航状态 =====
  // 默认选中"通用"导航项
  const activeNavItem = ref('general')
  // 默认展开"工作区"分组
  const expandedGroups = ref<string[]>(['workspace'])
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
   * 通过映射表将 Tab 标识转换为导航项 ID，
   * 未指定时默认导航到"通用"页。
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
   * 已打开时关闭，已关闭时重新打开到指定（或当前）Tab。
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
   * 直接使用导航项 ID，不经过 Tab 映射。
   *
   * @param itemId - 导航项 ID
   */
  function setActiveNavItem(itemId: string): void {
    activeNavItem.value = itemId
  }

  /**
   * 通过 Tab 标识设置当前激活的导航项
   *
   * 内部通过映射表将 Tab 转换为导航项 ID，
   * 如果映射表中无对应项则直接使用 tab 值作为 fallback。
   *
   * @param tab - Tab 标识
   */
  function setActiveTab(tab: SettingsTab): void {
    activeNavItem.value = TAB_TO_NAV_ITEM_MAP[tab] || tab
  }

  /**
   * 切换导航分组的展开/折叠状态
   *
   * 已展开则折叠，已折叠则展开。
   *
   * @param groupId - 分组 ID
   */
  function toggleGroup(groupId: string): void {
    const idx = expandedGroups.value.indexOf(groupId)
    if (idx >= 0) {
      expandedGroups.value.splice(idx, 1)
    } else {
      expandedGroups.value.push(groupId)
    }
  }

  /**
   * 展开指定导航分组（仅展开，不折叠）
   *
   * 用于外部需要确保某个分组处于展开状态的场景。
   *
   * @param groupId - 分组 ID
   */
  function expandGroup(groupId: string): void {
    if (!expandedGroups.value.includes(groupId)) {
      expandedGroups.value.push(groupId)
    }
  }

  /** 面板是否处于打开状态（visible 的别名，语义更清晰） */
  const isOpen = computed(() => visible.value)

  // --- 导出 ---
  /**
   * Store 对外暴露的响应式状态与导航控制方法
   *
   * 状态：visible / isOpen / activeNavItem / expandedGroups / searchQuery / activeTab
   * 方法：open / close / toggle / setActiveNavItem / setActiveTab / toggleGroup / expandGroup
   */
  return {
    visible,
    isOpen,
    activeNavItem,
    expandedGroups,
    searchQuery,
    activeTab,
    open,
    close,
    toggle,
    setActiveNavItem,
    setActiveTab,
    toggleGroup,
    expandGroup,
  }
})

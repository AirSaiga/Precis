/**
 * @file settingsStore.ts
 * @description 设置面板状态管理（门面 Store）
 *
 * 本 Store 作为统一门面，将职责委托给以下子 Store：
 * - settingsNavStore:     面板导航、可见性、搜索
 * - settingsPreferencesStore: 通用偏好、脚本设置、开发设置、localStorage
 * - projectSettingsStore: 项目设置 API（后端 YAML 持久化）
 *
 * 所有类型和常量继续从本文件导出以保持向后兼容。
 */

import { defineStore, storeToRefs } from 'pinia'
import { useSettingsNavStore } from './settingsNavStore'
import { useSettingsPreferencesStore } from './settingsPreferencesStore'
import { useProjectSettingsStore } from './projectSettingsStore'

// ============================================================================
// 重新导出类型与常量（保持外部导入兼容）
// ============================================================================

export type {
  SettingsTab,
  SettingsNavGroup,
  SettingsNavItem,
  GeneralSettings,
  ValidationSettings,
  FileProcessingSettings,
  ScriptSecuritySettings,
  ProjectSettings,
  ScriptSettings,
  DevSettings,
} from '@/types/settings'

export {
  defaultValidationSettings,
  defaultFileProcessingSettings,
  defaultScriptSecuritySettings,
  defaultProjectSettings,
  defaultScriptSettings,
  defaultGeneralSettings,
  defaultDevSettings,
  TAB_TO_NAV_ITEM_MAP,
  NAV_ITEM_TO_TAB_MAP,
} from '@/types/settings'

// ============================================================================
// 门面 Store
//
// 职责：将三个子 Store 的状态和方法聚合到单一 API，
// 让调用方无需关心内部分拆细节。
// ============================================================================

/**
 * 设置面板门面 Store 工厂函数
 *
 * 采用门面模式（Facade Pattern），将三个子 Store 的状态和方法聚合为单一 API：
 * - settingsNavStore：面板导航、可见性、搜索
 * - settingsPreferencesStore：通用偏好、脚本设置、开发设置、localStorage 持久化
 * - projectSettingsStore：项目设置 API（后端 YAML 持久化）
 *
 * 调用方只需导入 useSettingsStore，无需关心内部子 Store 的分拆细节。
 */
export const useSettingsStore = defineStore('settings', () => {
  // --- 子 Store 实例化 ---
  const navStore = useSettingsNavStore()
  const prefStore = useSettingsPreferencesStore()
  const projStore = useProjectSettingsStore()

  // --- 导航状态 (storeToRefs 保持响应性) ---
  // storeToRefs 将子 Store 的 state 解构为独立 ref，避免直接解构丢失响应性
  const { visible, isOpen, activeNavItem, searchQuery, activeTab } = storeToRefs(navStore)

  // --- 偏好设置状态 ---
  const {
    generalSettings,
    scriptSettings,
    devSettings,
    autoOrganizeOnNodeAdd,
    autoOrganizeOnNodeDelete,
    autoOrganizeOnConnectionChange,
    isScriptEnabled,
    isScriptAdminOnly,
    teamFeaturesEnabled,
  } = storeToRefs(prefStore)

  // isDevMode 是 getter（非 state），直接取引用即可，无需 storeToRefs
  const isDevMode = prefStore.isDevMode

  // ----- 项目设置状态 -----
  const {
    projectSettings,
    projectSettingsLoaded,
    isLoadingProjectSettings,
    saveStatus,
    saveErrorMessage,
    validationSettings,
    projectValidationRunDefaults,
    fileProcessingSettings,
    scriptSecuritySettings,
  } = storeToRefs(projStore)

  // --- 导出 ---
  /**
   * 门面 Store 对外暴露的聚合状态与操作方法
   *
   * 按职责分区：导航 / 偏好设置 / 项目设置 / 快捷 Computed / 控制方法
   */
  return {
    // 可见性 & 导航
    visible,
    isOpen,
    activeNavItem,
    searchQuery,
    activeTab,

    // 偏好设置
    generalSettings,
    scriptSettings,
    devSettings,
    autoOrganizeOnNodeAdd,
    autoOrganizeOnNodeDelete,
    autoOrganizeOnConnectionChange,
    isDevMode,

    // 项目设置
    projectSettings,
    projectSettingsLoaded,
    isLoadingProjectSettings,
    saveStatus,
    saveErrorMessage,

    // Computed 快捷访问
    validationSettings,
    projectValidationRunDefaults,
    fileProcessingSettings,
    scriptSecuritySettings,
    isScriptEnabled,
    isScriptAdminOnly,
    teamFeaturesEnabled,

    // 导航控制
    open: navStore.open,
    close: navStore.close,
    toggle: navStore.toggle,
    setActiveNavItem: navStore.setActiveNavItem,
    setActiveTab: navStore.setActiveTab,

    // 脚本控制
    enableScript: prefStore.enableScript,
    disableScript: prefStore.disableScript,
    markWarningShown: prefStore.markWarningShown,
    toggleTeamFeatures: prefStore.toggleTeamFeatures,
    setScriptRequireAdmin: prefStore.setScriptRequireAdmin,

    // 项目设置 API
    loadProjectSettings: projStore.loadProjectSettings,
    saveProjectSettings: projStore.saveProjectSettings,
    debouncedSaveProjectSettings: projStore.debouncedSaveProjectSettings,

    // 设置更新
    updateValidationSettings: projStore.updateValidationSettings,
    updateFileProcessingSettings: projStore.updateFileProcessingSettings,
    updateScriptSecuritySettings: projStore.updateScriptSecuritySettings,
    updateGeneralSettings: prefStore.updateGeneralSettings,
    getProjectValidationRunDefaults: projStore.getProjectValidationRunDefaults,
    mergeProjectValidationRunSettings: projStore.mergeProjectValidationRunSettings,
  }
})

export default useSettingsStore

/**
 * @file settingsPreferencesStore.ts
 * @description 用户偏好设置状态管理
 *
 * 职责：
 * - 通用设置（语言、主题、启动行为）
 * - 脚本设置（启用状态、权限警告）
 * - 开发设置（团队功能）
 * - 自动整理偏好
 * - localStorage 持久化
 */

import { logger } from '@/core/utils/logger'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { defaultGeneralSettings, defaultScriptSettings, defaultDevSettings } from '@/types/settings'
import type { GeneralSettings, ScriptSettings, DevSettings } from '@/types/settings'

export const useSettingsPreferencesStore = defineStore('settingsPreferences', () => {
  // ===== 设置状态 =====
  // 启动时立即从 localStorage 恢复，确保用户偏好不丢失
  const generalSettings = ref<GeneralSettings>(loadGeneralSettings())
  const scriptSettings = ref<ScriptSettings>(loadScriptSettings())
  const devSettings = ref<DevSettings>(loadDevSettings())

  // ===== 自动整理偏好 =====
  // 控制画布节点在添加/删除/连线变更时是否自动触发布局整理
  const autoOrganizeOnNodeAdd = ref(false)
  const autoOrganizeOnNodeDelete = ref(false)
  const autoOrganizeOnConnectionChange = ref(false)

  // ===== 开发模式 =====
  // 通过 Vite 环境变量判断，生产环境始终为 false
  const isDevMode = import.meta.env.DEV

  // ============================================================================
  // 本地存储读写
  //
  // 每种设置类型都有独立的 load/save 函数对，
  // 采用"默认值 + 存储值合并"策略保证向前兼容。
  // ============================================================================

  /**
   * 从 localStorage 加载脚本设置
   *
   * 采用"默认值兜底 + 已存储值覆盖"的合并策略，
   * 当 localStorage 中缺少新版本新增字段时，默认值自动填充。
   */
  function loadScriptSettings(): ScriptSettings {
    try {
      const stored = localStorage.getItem('scriptSettings')
      if (stored) {
        return { ...defaultScriptSettings, ...JSON.parse(stored) }
      }
    } catch {
      logger.warn('[SettingsPreferencesStore] 加载脚本设置失败，使用默认值')
    }
    return { ...defaultScriptSettings }
  }

  /** 将脚本设置持久化到 localStorage（由 watch 自动触发） */
  function saveScriptSettings(): void {
    try {
      localStorage.setItem('scriptSettings', JSON.stringify(scriptSettings.value))
    } catch {
      logger.warn('[SettingsPreferencesStore] 保存脚本设置失败')
    }
  }

  /**
   * 从 localStorage 加载通用设置（语言、主题、启动行为等）
   *
   * 与 loadScriptSettings 相同的合并策略，保证新增字段有默认值。
   */
  function loadGeneralSettings(): GeneralSettings {
    try {
      const stored = localStorage.getItem('generalSettings')
      if (stored) {
        return { ...defaultGeneralSettings, ...JSON.parse(stored) }
      }
    } catch {
      logger.warn('[SettingsPreferencesStore] 加载通用设置失败，使用默认值')
    }
    return { ...defaultGeneralSettings }
  }

  /** 将通用设置持久化到 localStorage（由 watch 自动触发） */
  function saveGeneralSettings(): void {
    try {
      localStorage.setItem('generalSettings', JSON.stringify(generalSettings.value))
    } catch {
      logger.warn('[SettingsPreferencesStore] 保存通用设置失败')
    }
  }

  /**
   * 从 localStorage 加载开发设置
   *
   * 非开发环境直接返回默认值，避免生产环境意外读取开发配置。
   */
  function loadDevSettings(): DevSettings {
    if (!import.meta.env.DEV) {
      return { ...defaultDevSettings }
    }
    try {
      const stored = localStorage.getItem('devSettings')
      if (stored) {
        return { ...defaultDevSettings, ...JSON.parse(stored) }
      }
    } catch {
      logger.warn('[SettingsPreferencesStore] 加载开发设置失败，使用默认值')
    }
    return { ...defaultDevSettings }
  }

  /** 将开发设置持久化到 localStorage（仅开发环境有意义） */
  function saveDevSettings(): void {
    try {
      localStorage.setItem('devSettings', JSON.stringify(devSettings.value))
    } catch {
      logger.warn('[SettingsPreferencesStore] 保存开发设置失败')
    }
  }

  // ============================================================================
  // 设置更新
  // ============================================================================

  /**
   * 批量更新通用设置字段
   *
   * 使用 Partial 合并而非整体替换，允许调用方只修改关心的字段。
   * 更改会通过 watch 自动触发 saveGeneralSettings 持久化。
   *
   * @param settings - 需要更新的字段子集
   */
  function updateGeneralSettings(settings: Partial<GeneralSettings>): void {
    generalSettings.value = { ...generalSettings.value, ...settings }
  }

  // ============================================================================
  // 脚本控制
  //
  // 脚本功能默认禁用，用户需主动启用并确认安全警告。
  // ============================================================================

  /** 启用脚本执行功能（启用后用户可在约束中使用脚本表达式） */
  function enableScript(): void {
    scriptSettings.value.enabled = true
  }

  /** 禁用脚本执行功能（禁用后所有脚本约束将不会执行） */
  function disableScript(): void {
    scriptSettings.value.enabled = false
  }

  /**
   * 设置脚本是否需要管理员权限
   *
   * 开启后仅管理员角色的用户可以编辑和执行脚本。
   *
   * @param require - 是否要求管理员权限
   */
  function setScriptRequireAdmin(require: boolean): void {
    scriptSettings.value.requireAdmin = require
  }

  /** 记录脚本安全警告已展示的时间戳（用于避免同一会话内重复弹出警告） */
  function markWarningShown(): void {
    scriptSettings.value.lastWarningTimestamp = Date.now()
  }

  // ============================================================================
  // 团队功能
  // ============================================================================

  /**
   * 切换团队功能的启用状态
   *
   * 团队功能目前作为实验性功能，仅在开发模式下可见。
   * 切换后立即持久化到 localStorage。
   */
  function toggleTeamFeatures(): void {
    devSettings.value.teamFeaturesEnabled = !devSettings.value.teamFeaturesEnabled
    saveDevSettings()
  }

  // ============================================================================
  // Computed
  // ============================================================================

  /** 脚本功能是否已启用 */
  const isScriptEnabled = computed(() => scriptSettings.value.enabled)

  /** 脚本功能是否限制为管理员专用 */
  const isScriptAdminOnly = computed(() => scriptSettings.value.requireAdmin)

  /**
   * 团队功能是否启用
   *
   * 生产环境强制返回 false，仅开发环境遵循用户配置。
   */
  const teamFeaturesEnabled = computed(() => {
    if (isDevMode) {
      return devSettings.value.teamFeaturesEnabled
    }
    return false
  })

  // ============================================================================
  // Watch
  //
  // 深度监听设置对象变化，自动触发持久化。
  // 用户无需手动保存，任何设置变更都会实时写入 localStorage。
  // ============================================================================

  watch(scriptSettings, saveScriptSettings, { deep: true })
  watch(generalSettings, saveGeneralSettings, { deep: true })

  return {
    generalSettings,
    scriptSettings,
    devSettings,
    autoOrganizeOnNodeAdd,
    autoOrganizeOnNodeDelete,
    autoOrganizeOnConnectionChange,
    isDevMode,
    isScriptEnabled,
    isScriptAdminOnly,
    teamFeaturesEnabled,
    updateGeneralSettings,
    enableScript,
    disableScript,
    setScriptRequireAdmin,
    markWarningShown,
    toggleTeamFeatures,
  }
})

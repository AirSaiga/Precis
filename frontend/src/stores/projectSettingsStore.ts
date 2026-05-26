/**
 * @file projectSettingsStore.ts
 * @description 项目设置状态管理（后端 API 驱动）
 *
 * 职责：
 * - 从后端加载/保存项目设置
 * - 校验参数、文件处理、脚本安全设置更新
 * - 防抖自动保存
 * - 保存状态跟踪
 */

import { logger } from '@/core/utils/logger'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getProjectSettings, updateProjectSettings } from '@/api/projectV2Api'
import { defaultProjectSettings } from '@/types/settings'
import type {
  ProjectSettings,
  ValidationSettings,
  FileProcessingSettings,
  ScriptSecuritySettings,
} from '@/types/settings'

/**
 * 项目设置 Store 工厂函数
 *
 * 职责：
 * - 从后端加载/保存项目设置（通过 projectV2Api）
 * - 管理校验参数、文件处理、脚本安全等子设置
 * - 防抖自动保存（避免频繁触发后端请求）
 * - 保存状态跟踪（idle / saving / saved / error）
 */
export const useProjectSettingsStore = defineStore('projectSettings', () => {
  // ===== 项目设置状态 =====
  // 初始化为默认值，待 loadProjectSettings 成功后替换为后端实际配置
  const projectSettings = ref<ProjectSettings>({ ...defaultProjectSettings })
  /** 设置是否已从后端成功加载过（区分"未加载"和"加载失败"） */
  const projectSettingsLoaded = ref(false)
  /** 是否正在从后端加载设置（防止重复请求） */
  const isLoadingProjectSettings = ref(false)

  // ===== 保存状态 =====
  /** 当前保存状态：idle / saving / saved / error */
  const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  /** 保存失败时的错误信息 */
  const saveErrorMessage = ref('')

  // ============================================================================
  // 项目设置 API
  // ============================================================================

  /**
   * 从后端加载项目设置（通过 isLoadingProjectSettings 防止并发重复请求）
   *
   * 加载失败时回退到默认值，确保前端不会因缺少配置而异常。
   */
  async function loadProjectSettings(): Promise<void> {
    if (isLoadingProjectSettings.value) {
      return
    }
    isLoadingProjectSettings.value = true
    try {
      const settings = await getProjectSettings()
      projectSettings.value = settings
      projectSettingsLoaded.value = true
    } catch (error) {
      logger.warn('[ProjectSettingsStore] 加载项目设置失败，使用默认值:', error)
      projectSettings.value = { ...defaultProjectSettings }
    } finally {
      isLoadingProjectSettings.value = false
    }
  }

  /**
   * 将项目设置保存到后端
   *
   * 保存成功后将状态标记为 'saved'，2 秒后自动恢复为 'idle'。
   * 失败时抛出异常，由调用方决定如何处理。
   */
  async function saveProjectSettings(): Promise<void> {
    saveStatus.value = 'saving'
    saveErrorMessage.value = ''
    try {
      await updateProjectSettings(projectSettings.value)
      saveStatus.value = 'saved'
      // 2 秒后将状态从 'saved' 恢复为 'idle'，避免 UI 持续显示已保存
      setTimeout(() => {
        if (saveStatus.value === 'saved') {
          saveStatus.value = 'idle'
        }
      }, 2000)
    } catch (error) {
      saveStatus.value = 'error'
      saveErrorMessage.value = String(error)
      logger.warn('[ProjectSettingsStore] 保存项目设置失败:', error)
      throw error
    }
  }

  // ============================================================================
  // 防抖保存
  //
  // 用户在设置面板中频繁触发变更时，防抖机制避免每次变更都发起后端请求。
  // ============================================================================

  /** 防抖定时器 ID */
  let saveDebounceTimer: number | null = null

  /**
   * 防抖保存项目设置
   *
   * 在指定延迟时间内如果没有新的变更，才真正执行保存。
   * 立即将状态标记为 'saving'，让 UI 显示保存中状态。
   *
   * @param delay - 防抖延迟时间（毫秒），默认 800ms
   */
  function debouncedSaveProjectSettings(delay = 800): void {
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer)
    }
    saveStatus.value = 'saving'
    saveDebounceTimer = window.setTimeout(async () => {
      try {
        await saveProjectSettings()
      } catch {
        // 错误已在 saveProjectSettings 中处理
      }
    }, delay)
  }

  // ============================================================================
  // 设置更新方法
  //
  // 每个更新方法都采用 Partial 合并策略，然后自动触发防抖保存。
  // ============================================================================

  /** 更新校验参数设置 @param settings - 需要更新的字段子集 */
  function updateValidationSettings(settings: Partial<ValidationSettings>): void {
    projectSettings.value.validation = { ...projectSettings.value.validation, ...settings }
    debouncedSaveProjectSettings()
  }

  /** 更新文件处理设置 @param settings - 需要更新的字段子集 */
  function updateFileProcessingSettings(settings: Partial<FileProcessingSettings>): void {
    projectSettings.value.file_processing = {
      ...projectSettings.value.file_processing,
      ...settings,
    }
    debouncedSaveProjectSettings()
  }

  /** 更新脚本安全设置 @param settings - 需要更新的字段子集 */
  function updateScriptSecuritySettings(settings: Partial<ScriptSecuritySettings>): void {
    projectSettings.value.script_security = {
      ...projectSettings.value.script_security,
      ...settings,
    }
    debouncedSaveProjectSettings()
  }

  /** 获取校验设置的快照副本（用于作为校验运行的默认参数） */
  function getProjectValidationRunDefaults(): ValidationSettings {
    return { ...projectSettings.value.validation }
  }

  /**
   * 合并项目校验设置与运行时覆盖
   *
   * @param overrides - 运行时覆盖的校验参数
   * @returns 合并后的校验设置
   */
  function mergeProjectValidationRunSettings(
    overrides?: Partial<ValidationSettings>
  ): ValidationSettings {
    return {
      ...projectSettings.value.validation,
      ...(overrides || {}),
    }
  }

  // ============================================================================
  // Computed 快捷访问
  // ============================================================================

  const validationSettings = computed(() => projectSettings.value.validation)
  const projectValidationRunDefaults = computed<ValidationSettings>(() => ({
    ...projectSettings.value.validation,
  }))
  const fileProcessingSettings = computed(() => projectSettings.value.file_processing)
  const scriptSecuritySettings = computed(() => projectSettings.value.script_security)

  // --- 导出 ---
  /**
   * Store 对外暴露的响应式状态、计算属性与操作方法
   *
   * 状态：projectSettings / projectSettingsLoaded / isLoadingProjectSettings / saveStatus / saveErrorMessage
   * 计算属性：validationSettings / projectValidationRunDefaults / fileProcessingSettings / scriptSecuritySettings
   * 方法：loadProjectSettings / saveProjectSettings / debouncedSaveProjectSettings / updateValidationSettings / updateFileProcessingSettings / updateScriptSecuritySettings / getProjectValidationRunDefaults / mergeProjectValidationRunSettings
   */
  return {
    projectSettings,
    projectSettingsLoaded,
    isLoadingProjectSettings,
    saveStatus,
    saveErrorMessage,
    validationSettings,
    projectValidationRunDefaults,
    fileProcessingSettings,
    scriptSecuritySettings,
    loadProjectSettings,
    saveProjectSettings,
    debouncedSaveProjectSettings,
    updateValidationSettings,
    updateFileProcessingSettings,
    updateScriptSecuritySettings,
    getProjectValidationRunDefaults,
    mergeProjectValidationRunSettings,
  }
})

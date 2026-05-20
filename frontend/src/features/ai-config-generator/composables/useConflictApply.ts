/**
 * @file useConflictApply.ts
 * @description AI 配置生成结果应用到项目的冲突检测与处理组合式函数
 *
 * 功能概述:
 * - 比较生成配置与现有配置的差异
 * - 检测是否存在实际变更（schema / constraint / regex_node）
 * - 打开 ConflictResolutionModal 供用户确认合并策略
 * - 确认后落盘并触发画布刷新
 *
 * 架构设计:
 * - 缓存现有完整配置（cachedFullConfig）避免重复请求
 * - 与 ConflictResolutionModal 通过 ref 控制显隐
 * - applyToProject 为入口，handleConflictConfirm 为模态框回调
 *
 * 输入示例:
 *   const conflict = useConflictApply(configPath, generatedConfig)
 *   await conflict.applyToProject()
 *
 * 输出示例:
 *   conflict.comparisonResult.value    // ConfigComparison | null
 *   conflict.conflictModalVisible.value // true | false
 */
import { ref, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { logger } from '@/core/utils/logger'
import { putV2FullConfig, getV2FullConfig, compareV2FullConfig } from '@/api/projectV2Api'
import type { AiGenerateV2ConfigResponse } from '@/types/ai'
import type { ConfigComparison } from '@/api/types/conflict'
import type {
  FullConfigV2Request,
  FullConfigV2Response,
  ProjectManifestV2,
} from '@/types/projectV2'

export function useConflictApply(
  configPath: ComputedRef<string | undefined>,
  generatedConfig: Ref<AiGenerateV2ConfigResponse | null>
) {
  const { t } = useI18n()

  /** 是否正在应用到项目 */
  const applying = ref(false)

  /** 冲突解决模态框显隐 */
  const conflictModalVisible = ref(false)

  /** 配置差异对比结果 */
  const comparisonResult = ref<ConfigComparison | null>(null)

  /** 原始 manifest */
  const originalManifest = ref<ProjectManifestV2 | null>(null)

  /** 缓存的现有完整配置 */
  const cachedFullConfig = ref<FullConfigV2Response | null>(null)

  /**
   * 将生成结果应用到项目：比较差异并打开冲突解决模态框
   */
  const applyToProject = async () => {
    if (!configPath.value) return
    if (!generatedConfig.value?.manifest) return

    applying.value = true
    try {
      // 1. 获取原始 manifest（复用缓存避免重复请求）
      let currentFull = cachedFullConfig.value
      if (!currentFull) {
        currentFull = await getV2FullConfig(configPath.value)
      }
      originalManifest.value = currentFull.manifest

      // 2. 对比差异
      const comparison = await compareV2FullConfig(
        {
          manifest: generatedConfig.value.manifest,
          schemas: generatedConfig.value.schemas || {},
          constraints: generatedConfig.value.constraints || {},
          regex_nodes: generatedConfig.value.regex_nodes || {},
          transforms: generatedConfig.value.transforms || {},
        },
        configPath.value
      )

      // 检查是否存在变更
      const hasChanges =
        comparison.schemas.length > 0 ||
        comparison.constraints.length > 0 ||
        comparison.regex_nodes.length > 0

      if (!hasChanges) {
        window.$toast?.info(t('common.info'), t('aiConfigGenerator.toast.noChanges'))
        applying.value = false
        return
      }

      // 3. 打开冲突模态框
      comparisonResult.value = comparison
      conflictModalVisible.value = true
      applying.value = false // 停止 spinner，等待模态框确认
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      window.$toast?.error(t('aiConfigGenerator.toast.applyFailed'), msg)
      applying.value = false
    }
  }

  /**
   * 用户确认冲突解决后的最终落盘操作
   */
  const handleConflictConfirm = async (finalConfig: FullConfigV2Request) => {
    if (!configPath.value) return

    conflictModalVisible.value = false
    applying.value = true

    try {
      await putV2FullConfig(finalConfig, configPath.value)

      window.dispatchEvent(new CustomEvent('project-applied'))
      window.$toast?.success(t('common.success'), t('aiConfigGenerator.toast.applied'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      window.$toast?.error(t('aiConfigGenerator.toast.applyFailed'), msg)
    } finally {
      applying.value = false
    }
  }

  return {
    applying,
    conflictModalVisible,
    comparisonResult,
    originalManifest,
    cachedFullConfig,
    applyToProject,
    handleConflictConfirm,
  }
}

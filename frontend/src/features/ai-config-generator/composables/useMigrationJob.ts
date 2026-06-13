/**
 * @file useMigrationJob.ts
 * @description AI 配置迁移任务生命周期管理组合式函数
 *
 * 功能概述:
 * - 提交 AI 配置迁移异步任务（从旧脚本迁移）
 * - 复用 useGenerationJob 的轮询和状态管理
 */
import { ref, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isAxiosError } from '@/core/services/httpClient'
import {
  getAiMigrateV2ConfigJob,
  postAiMigrateV2ConfigJob,
  postCancelAiMigrateV2ConfigJob,
} from '@/api/aiApi'
import type {
  AiGenerateV2ConfigJobStatus,
  AiGenerateV2ConfigOptions,
  AiGenerateV2ConfigResponse,
  CloudAIProviderResponse,
} from '@/types/ai'

export function useMigrationJob(
  configPath: ComputedRef<string | undefined>,
  checkedFiles: Ref<Set<string>>,
  options: Ref<AiGenerateV2ConfigOptions>,
  activeProvider: Ref<CloudAIProviderResponse | null>,
  jobState: {
    generating: Ref<boolean>
    canceling: Ref<boolean>
    jobId: Ref<string | null>
    currentStage: Ref<string>
    progressMessage: Ref<string>
    warnings: Ref<string[]>
    generateStartedAt: Ref<number | null>
    lastElapsedMs: Ref<number | null>
    elapsedNow: Ref<number>
    pollTimer: Ref<number | null>
    elapsedTimer: Ref<number | null>
    generatedConfig: Ref<AiGenerateV2ConfigResponse | null>
    yamlPreview: Ref<string>
  }
) {
  const { t } = useI18n()

  const stopPolling = () => {
    if (jobState.pollTimer.value) {
      window.clearInterval(jobState.pollTimer.value)
      jobState.pollTimer.value = null
    }
  }

  const stopElapsed = () => {
    if (jobState.elapsedTimer.value) {
      window.clearInterval(jobState.elapsedTimer.value)
      jobState.elapsedTimer.value = null
    }
  }

  const handleJobStatus = (status: AiGenerateV2ConfigJobStatus) => {
    jobState.warnings.value = status.warnings || []
    jobState.currentStage.value = status.stage || ''
    jobState.progressMessage.value = status.message || ''

    if (status.status === 'completed') {
      const result = status.result
      if (result) {
        jobState.generatedConfig.value = result
        jobState.yamlPreview.value = result.yaml_preview || ''
        window.$toast?.success(t('common.success'), t('aiConfigGenerator.toast.generated'))
      }
      jobState.generating.value = false
      jobState.canceling.value = false
      stopPolling()
      if (jobState.generateStartedAt.value != null)
        jobState.lastElapsedMs.value = Date.now() - jobState.generateStartedAt.value
      jobState.generateStartedAt.value = null
      stopElapsed()
      return
    }

    if (status.status === 'failed') {
      const msg = status.error || status.message || t('aiConfigGenerator.toast.generateFailed')
      jobState.generating.value = false
      jobState.canceling.value = false
      stopPolling()
      if (jobState.generateStartedAt.value != null)
        jobState.lastElapsedMs.value = Date.now() - jobState.generateStartedAt.value
      jobState.generateStartedAt.value = null
      stopElapsed()
      window.$toast?.error(t('aiConfigGenerator.toast.generateFailed'), msg)
      return
    }

    if (status.status === 'cancelled') {
      jobState.generating.value = false
      jobState.canceling.value = false
      stopPolling()
      if (jobState.generateStartedAt.value != null)
        jobState.lastElapsedMs.value = Date.now() - jobState.generateStartedAt.value
      jobState.generateStartedAt.value = null
      stopElapsed()
      window.$toast?.info(t('common.info'), t('aiConfigGenerator.toast.canceled'))
    }
  }

  const pollJob = async () => {
    if (!configPath.value || !jobState.jobId.value) return
    try {
      const status = await getAiMigrateV2ConfigJob(jobState.jobId.value, configPath.value)
      handleJobStatus(status)
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e)
      if (isAxiosError(e)) {
        const data = e.response?.data as unknown
        if (typeof data === 'string' && data.trim()) {
          msg = data
        } else if (data && typeof data === 'object') {
          const obj = data as Record<string, unknown>
          if (obj.detail) msg = String(obj.detail)
          else if (obj.error) msg = String(obj.error)
          else if (e.message) msg = e.message
        }
      }
      jobState.generating.value = false
      jobState.canceling.value = false
      stopPolling()
      window.$toast?.error(t('aiConfigGenerator.toast.generateFailed'), msg)
    }
  }

  const startMigration = async (
    sources: Array<{ content: string; language: string; name?: string }>,
    projectName: string
  ) => {
    if (!configPath.value) {
      window.$toast?.error(t('common.error'), t('aiConfigGenerator.errors.missingProject'))
      return
    }
    if (checkedFiles.value.size === 0) {
      window.$toast?.info(t('common.info'), t('aiConfigGenerator.errors.noFiles'))
      return
    }
    if (!activeProvider.value?.is_configured) {
      window.$toast?.error(t('common.error'), t('aiConfigGenerator.errors.modelNotConfigured'))
      return
    }
    if (!sources.length || !sources.some((s) => s.content.trim())) {
      window.$toast?.info(t('common.info'), t('aiConfigGenerator.migrate.emptySources'))
      return
    }

    jobState.generating.value = true
    jobState.canceling.value = false
    jobState.warnings.value = []
    jobState.generateStartedAt.value = Date.now()
    jobState.lastElapsedMs.value = null
    jobState.elapsedNow.value = Date.now()
    stopElapsed()
    jobState.elapsedTimer.value = window.setInterval(() => {
      jobState.elapsedNow.value = Date.now()
    }, 250)
    jobState.yamlPreview.value = ''
    jobState.generatedConfig.value = null
    jobState.jobId.value = null
    jobState.currentStage.value = 'queued'
    jobState.progressMessage.value = t('aiConfigGenerator.progress.queued')

    try {
      const first = sources[0]
      if (!first) {
        window.$toast?.info(t('common.info'), t('aiConfigGenerator.migrate.emptySources'))
        return
      }
      const payload = {
        script_content: first.content,
        language: first.language,
        sources,
        file_paths: Array.from(checkedFiles.value),
        project_name: projectName,
        project_id: projectName,
        provider_id: activeProvider.value?.id,
        options: options.value,
      }
      const created = await postAiMigrateV2ConfigJob(payload, configPath.value)
      jobState.jobId.value = created.job_id
      stopPolling()
      jobState.pollTimer.value = window.setInterval(pollJob, 600)
      await pollJob()
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e)
      if (isAxiosError(e)) {
        const data = e.response?.data as unknown
        if (typeof data === 'string' && data.trim()) {
          msg = data
        } else if (data && typeof data === 'object') {
          const obj = data as Record<string, unknown>
          if (obj.detail) msg = String(obj.detail)
          else if (obj.error) msg = String(obj.error)
          else if (e.message) msg = e.message
        }
      }
      window.$toast?.error(t('aiConfigGenerator.toast.generateFailed'), msg)
      jobState.generating.value = false
      jobState.canceling.value = false
      stopPolling()
      if (jobState.generateStartedAt.value != null)
        jobState.lastElapsedMs.value = Date.now() - jobState.generateStartedAt.value
      jobState.generateStartedAt.value = null
      stopElapsed()
    } finally {
      if (!jobState.jobId.value) {
        jobState.generating.value = false
        if (jobState.generateStartedAt.value != null)
          jobState.lastElapsedMs.value = Date.now() - jobState.generateStartedAt.value
        jobState.generateStartedAt.value = null
        stopElapsed()
      }
    }
  }

  const cancelMigration = async () => {
    if (!configPath.value || !jobState.jobId.value) return
    if (jobState.canceling.value) return
    jobState.canceling.value = true
    try {
      const status = await postCancelAiMigrateV2ConfigJob(jobState.jobId.value, configPath.value)
      handleJobStatus(status)
    } catch (e) {
      jobState.canceling.value = false
      const msg = e instanceof Error ? e.message : String(e)
      window.$toast?.error(t('common.error'), msg)
    }
  }

  return {
    startMigration,
    cancelMigration,
    stopPolling,
    stopElapsed,
  }
}

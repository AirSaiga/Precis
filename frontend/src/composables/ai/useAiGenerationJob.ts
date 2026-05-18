/**
 * @file useAiGenerationJob.ts
 * @description AI 配置生成任务生命周期管理组合式函数
 *
 * 功能概述:
 * - 提交 AI 配置生成异步任务
 * - 轮询任务状态（queued → running → completed/failed/canceled）
 * - 管理生成计时器、阶段文案、流式字符计数
 * - 处理任务完成/失败/取消/异常等各终态
 *
 * 架构设计:
 * - 与 useAiFileSelection 联动：读取 checkedFiles 作为输入
 * - 与父组件联动：通过 generatedConfig / yamlPreview / warnings 等 ref 共享结果
 * - 计时器独立管理：elapsedTimer 每 250ms 更新，pollTimer 每 600ms 轮询
 *
 * 输入示例:
 *   const job = useAiGenerationJob(configPath, checkedFiles, options, activeProvider, t)
 *   await job.generate(async () => { await runHardwarePrecheck() })
 *
 * 输出示例:
 *   job.generating.value        // true | false
 *   job.generatedConfig.value   // AiGenerateV2ConfigResponse | null
 *   job.elapsedTimeText.value   // "01:23"
 */
import { logger } from '@/core/utils/logger'
import { computed, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import axios from 'axios'
import { useGraphStore } from '@/stores/graphStore'
import {
  getAiGenerateV2ConfigJob,
  postAiGenerateV2ConfigJob,
  postCancelAiGenerateV2ConfigJob,
} from '@/api/aiApi'
import type {
  AiGenerateV2ConfigJobStatus,
  AiGenerateV2ConfigOptions,
  AiGenerateV2ConfigResponse,
  CloudAIProviderResponse,
} from '@/types/ai'

export function useAiGenerationJob(
  configPath: ComputedRef<string | undefined>,
  checkedFiles: Ref<Set<string>>,
  options: Ref<AiGenerateV2ConfigOptions>,
  activeProvider: Ref<CloudAIProviderResponse | null>,
  t: (key: string, ...args: unknown[]) => string
) {
  const graphStore = useGraphStore()

  /** 是否正在生成（轮询任务状态中） */
  const generating = ref(false)

  /** 是否正在请求中断 */
  const canceling = ref(false)

  /** 当前生成任务 ID */
  const jobId = ref<string | null>(null)

  /** 当前阶段标识（由后端提供） */
  const currentStage = ref('')

  /** 当前阶段的描述文案 */
  const progressMessage = ref('')

  /** Ollama 流式输出累计字符数 */
  const receivedChars = ref(0)

  /** 后端返回的提示信息 */
  const warnings = ref<string[]>([])

  /** 生成开始时间戳 */
  const generateStartedAt = ref<number | null>(null)

  /** 最后一次记录的耗时（用于停止后保持显示） */
  const lastElapsedMs = ref<number | null>(null)

  /** 当前用于计算耗时的实时时间戳 */
  const elapsedNow = ref<number>(Date.now())

  /** 轮询定时器句柄 */
  const pollTimer = ref<number | null>(null)

  /** 计时器句柄 */
  const elapsedTimer = ref<number | null>(null)

  /** 生成完成后返回的结构化配置 */
  const generatedConfig = ref<AiGenerateV2ConfigResponse | null>(null)

  /** YAML 预览文本 */
  const yamlPreview = ref('')

  const formatDuration = (ms: number) => {
    const clamped = Math.max(0, Math.floor(ms))
    const totalSeconds = Math.floor(clamped / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    const mm = String(minutes).padStart(2, '0')
    const ss = String(seconds).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const elapsedMs = computed(() => {
    if (generateStartedAt.value != null) return elapsedNow.value - generateStartedAt.value
    if (lastElapsedMs.value != null) return lastElapsedMs.value
    return 0
  })

  /** 格式化后的耗时文本 */
  const elapsedTimeText = computed(() => formatDuration(elapsedMs.value))

  /** 当前阶段的 i18n 文案 */
  const stageLabel = computed(() => {
    if (!currentStage.value) return t('aiConfigGenerator.progressStages.unknown')
    const key = `aiConfigGenerator.progressStages.${currentStage.value}`
    const translated = t(key)
    return translated === key ? currentStage.value : translated
  })

  /** 停止轮询 */
  const stopPolling = () => {
    if (pollTimer.value) {
      window.clearInterval(pollTimer.value)
      pollTimer.value = null
    }
  }

  /** 停止计时 */
  const stopElapsed = () => {
    if (elapsedTimer.value) {
      window.clearInterval(elapsedTimer.value)
      elapsedTimer.value = null
    }
  }

  /**
   * 处理任务状态更新
   */
  const handleJobStatus = (status: AiGenerateV2ConfigJobStatus) => {
    warnings.value = status.warnings || []
    currentStage.value = status.stage || ''
    progressMessage.value = status.message || ''
    receivedChars.value = typeof status.received_chars === 'number' ? status.received_chars : 0

    if (status.status === 'completed') {
      const result = status.result
      if (result) {
        generatedConfig.value = result
        yamlPreview.value = result.yaml_preview || ''
        window.$toast?.success(t('common.success'), t('aiConfigGenerator.toast.generated'))
      }
      generating.value = false
      canceling.value = false
      stopPolling()
      if (generateStartedAt.value != null)
        lastElapsedMs.value = Date.now() - generateStartedAt.value
      generateStartedAt.value = null
      stopElapsed()
      return
    }

    if (status.status === 'failed') {
      const msg = status.error || status.message || t('aiConfigGenerator.toast.generateFailed')
      generating.value = false
      canceling.value = false
      stopPolling()
      if (generateStartedAt.value != null)
        lastElapsedMs.value = Date.now() - generateStartedAt.value
      generateStartedAt.value = null
      stopElapsed()
      window.$toast?.error(t('aiConfigGenerator.toast.generateFailed'), msg)
      return
    }

    if (status.status === 'canceled') {
      generating.value = false
      canceling.value = false
      stopPolling()
      if (generateStartedAt.value != null)
        lastElapsedMs.value = Date.now() - generateStartedAt.value
      generateStartedAt.value = null
      stopElapsed()
      window.$toast?.info(t('common.info'), t('aiConfigGenerator.toast.canceled'))
    }
  }

  /**
   * 轮询任务状态
   */
  const pollJob = async () => {
    if (!configPath.value || !jobId.value) return
    try {
      const status = await getAiGenerateV2ConfigJob(jobId.value, configPath.value)
      handleJobStatus(status)
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e)
      if (axios.isAxiosError(e)) {
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
      generating.value = false
      canceling.value = false
      stopPolling()
      window.$toast?.error(t('aiConfigGenerator.toast.generateFailed'), msg)
    }
  }

  /**
   * 启动生成任务
   * @param onBeforeSubmit - 提交前的回调（如硬件预检、缓存加载）
   */
  const generate = async (onBeforeSubmit?: () => Promise<void>) => {
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

    generating.value = true
    canceling.value = false
    warnings.value = []
    generateStartedAt.value = Date.now()
    lastElapsedMs.value = null
    elapsedNow.value = Date.now()
    stopElapsed()
    elapsedTimer.value = window.setInterval(() => {
      elapsedNow.value = Date.now()
    }, 250)
    yamlPreview.value = ''
    generatedConfig.value = null
    jobId.value = null
    currentStage.value = 'queued'
    progressMessage.value = t('aiConfigGenerator.progress.queued')
    receivedChars.value = 0

    try {
      if (onBeforeSubmit) await onBeforeSubmit()

      const payload = {
        file_paths: Array.from(checkedFiles.value),
        project_name: graphStore.projectName || undefined,
        project_id: undefined,
        options: {
          ...options.value,
        },
      }

      const created = await postAiGenerateV2ConfigJob(payload, configPath.value)
      jobId.value = created.job_id
      stopPolling()
      pollTimer.value = window.setInterval(pollJob, 600)
      await pollJob()
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e)
      if (axios.isAxiosError(e)) {
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
    } finally {
      if (!jobId.value) {
        generating.value = false
        if (generateStartedAt.value != null)
          lastElapsedMs.value = Date.now() - generateStartedAt.value
        generateStartedAt.value = null
        stopElapsed()
      }
    }
  }

  /**
   * 取消当前生成任务
   */
  const cancelGenerate = async () => {
    if (!configPath.value || !jobId.value) return
    if (canceling.value) return
    canceling.value = true
    try {
      const status = await postCancelAiGenerateV2ConfigJob(jobId.value, configPath.value)
      handleJobStatus(status)
    } catch (e) {
      canceling.value = false
      const msg = e instanceof Error ? e.message : String(e)
      window.$toast?.error(t('common.error'), msg)
    }
  }

  onUnmounted(() => {
    stopPolling()
    stopElapsed()
  })

  return {
    generating,
    canceling,
    jobId,
    currentStage,
    progressMessage,
    receivedChars,
    warnings,
    generateStartedAt,
    lastElapsedMs,
    elapsedNow,
    elapsedTimeText,
    stageLabel,
    generatedConfig,
    yamlPreview,
    generate,
    cancelGenerate,
    stopPolling,
    stopElapsed,
    handleJobStatus,
  }
}

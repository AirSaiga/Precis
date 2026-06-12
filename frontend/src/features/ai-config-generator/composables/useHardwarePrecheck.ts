/**
 * @file useHardwarePrecheck.ts
 * @description AI 硬件预检组合式函数
 *
 * 功能概述:
 * - 在配置生成前调用后端硬件诊断接口
 * - 根据当前活动的 AI Provider 类型执行对应的诊断
 * - 收集并展示硬件相关警告（如内存不足、GPU 不可用等）
 *
 * 架构设计:
 * - 独立于生成任务生命周期，可被 useGenerationJob 在生成前调用
 * - 结果存储在 hardwareWarnings ref 中，供 UI 展示
 */
import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getAiHardwareDiagnose } from '@/api/aiApi'
import type { CloudAIProviderResponse } from '@/types/ai'

export function useHardwarePrecheck(activeProvider: Ref<CloudAIProviderResponse | null>) {
  const { t } = useI18n()

  /** 硬件预检警告信息 */
  const hardwareWarnings = ref<string[]>([])

  /**
   * 执行硬件预检
   */
  const runHardwarePrecheck = async () => {
    try {
      const provider = activeProvider.value?.provider || undefined
      const res = await getAiHardwareDiagnose('advanced', provider)
      hardwareWarnings.value = Array.isArray(res.warnings) ? res.warnings : []
      if (hardwareWarnings.value.length > 0) {
        window.$toast?.warning(
          t('aiConfigGenerator.hardware.title'),
          hardwareWarnings.value.join('\n')
        )
      }
    } catch {
      hardwareWarnings.value = []
    }
  }

  return {
    hardwareWarnings,
    runHardwarePrecheck,
  }
}

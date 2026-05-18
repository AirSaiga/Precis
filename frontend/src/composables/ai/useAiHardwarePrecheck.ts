/**
 * @file useAiHardwarePrecheck.ts
 * @description AI 硬件预检组合式函数
 *
 * 功能概述:
 * - 在配置生成前调用后端硬件诊断接口
 * - 根据当前活动的 AI Provider 类型执行对应的诊断
 * - 收集并展示硬件相关警告（如内存不足、GPU 不可用等）
 *
 * 架构设计:
 * - 独立于生成任务生命周期，可被 useAiGenerationJob 在生成前调用
 * - 结果存储在 hardwareWarnings ref 中，供 UI 展示
 *
 * 输入示例:
 *   const precheck = useAiHardwarePrecheck(activeProvider, t)
 *   await precheck.runHardwarePrecheck()
 *
 * 输出示例:
 *   precheck.hardwareWarnings.value  // ['内存不足，建议关闭其他应用']
 */
import { ref, type Ref } from 'vue'
import { getAiHardwareDiagnose } from '@/api/aiApi'
import type { CloudAIProviderResponse } from '@/types/ai'

export function useAiHardwarePrecheck(
  activeProvider: Ref<CloudAIProviderResponse | null>,
  t: (key: string, ...args: unknown[]) => string
) {
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

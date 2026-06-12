/**
 * @file useConstraintLayout.ts
 * @description 约束节点布局通用逻辑组合式函数
 *
 * 核心功能：
 * - 统一计算约束节点的显示状态
 * - 提供 statusText、errorCount、showDetails 等通用计算属性
 * - 统一处理校验调度逻辑
 */

import { computed, ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

export interface UseConstraintLayoutOptions {
  /** 获取校验状态的函数 */
  getStatus: () => string
  /** 获取错误列表的函数 */
  getErrors: () => string[]
  /** 获取 lastValidation 的函数 */
  getLastValidation?: () =>
    | { errorCount?: number; totalRows?: number; matchCount?: number }
    | undefined
  /** 是否启用自动校验 */
  enableAutoValidate?: boolean
  /** 校验函数 */
  validateFn?: () => Promise<void>
  /** 校验延迟（ms） */
  validateDelay?: number
  /** 额外的状态文本映射 */
  statusTextMap?: Record<string, string>
}

export function useConstraintLayout<T>(
  props: { data: T; selected?: boolean },
  options: UseConstraintLayoutOptions
) {
  const { t } = useI18n()
  const validationTimer = ref<number | undefined>(undefined)

  // ===== 状态计算 =====

  /** 校验状态 */
  const status = computed(() => options.getStatus() || 'idle')

  /** 校验错误列表 */
  const validationErrors = computed(() => options.getErrors() || [])

  /** 默认状态文本映射 */
  const defaultStatusMap: Record<string, string> = {
    idle: t('customNodes.constraintRules.statusIdle', '未校验'),
    pass: t('customNodes.constraintRules.statusPass', '通过'),
    error: t('customNodes.constraintRules.statusError', '失败'),
    missing: t('customNodes.constraintRules.statusMissing', '配置缺失'),
  }

  /** 状态显示文本 */
  const statusText = computed(() => {
    const customMap = options.statusTextMap || {}
    return customMap[status.value] || defaultStatusMap[status.value] || defaultStatusMap.idle
  })

  /** 错误计数 */
  const errorCount = computed(() => {
    const last = options.getLastValidation?.()
    if (last && typeof last.errorCount === 'number') {
      return last.errorCount
    }
    return validationErrors.value.length
  })

  /** 是否显示详情 */
  const showDetails = computed(() => {
    if (props.selected) return true
    if (status.value === 'error') return true
    return !!options.getLastValidation?.() || validationErrors.value.length > 0
  })

  // ===== 校验调度 =====

  /**
   * 立即执行校验
   */
  const validateNow = async () => {
    if (!options.validateFn) return
    await nextTick()
    await options.validateFn().catch(() => undefined)
  }

  /**
   * 延迟执行校验（防抖）
   */
  const scheduleValidation = () => {
    if (!options.validateFn) return
    if (validationTimer.value) {
      window.clearTimeout(validationTimer.value)
    }
    validationTimer.value = window.setTimeout(() => {
      validateNow().catch(() => undefined)
    }, options.validateDelay ?? 300)
  }

  /**
   * 清除校验定时器
   */
  const clearValidationTimer = () => {
    if (validationTimer.value) {
      window.clearTimeout(validationTimer.value)
      validationTimer.value = undefined
    }
  }

  return {
    // 状态
    status,
    statusText,
    validationErrors,
    errorCount,
    showDetails,

    // 方法
    validateNow,
    scheduleValidation,
    clearValidationTimer,
  }
}

/**
 * 构建详情区 metric 数据
 */
export function buildMetrics(
  lastValidation: { totalRows?: number; matchCount?: number; errorCount?: number } | undefined,
  t: (key: string, fallback?: string) => string
) {
  if (!lastValidation) return []

  return [
    {
      label: t('customNodes.constraintRules.totalRows', '总行数'),
      value: lastValidation.totalRows || 0,
    },
    {
      label: t('customNodes.constraintRules.matchCount', '匹配'),
      value: lastValidation.matchCount || 0,
    },
    {
      label: t('customNodes.constraintRules.errorCount', '错误'),
      value: lastValidation.errorCount || 0,
    },
  ]
}

/**
 * 截断文本显示
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

/**
 * 格式化数值显示
 */
export function formatNumericValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const num = Number(value)
  if (isNaN(num)) return String(value)
  if (Number.isInteger(num)) return String(num)
  return String(num)
}

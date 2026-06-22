/**
 * @file useConstraintNodeBase.ts
 * @description 约束节点通用逻辑封装
 *
 * 提取所有约束节点组件中重复的 computed、ref 和方法，
 * 使各组件只保留约束类型特有的逻辑。
 *
 * 统一提取的内容：
 * - validationStatus / displayErrors
 * - errorCount / showDetails / statusText / metrics
 * - handleSave / handleDelete
 */

import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGraphStore } from '@/stores/graphStore'
import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
import type { BaseConstraintNodeData } from '@/types/constraints'

export interface ConstraintNodeBaseOptions<TData extends BaseConstraintNodeData> {
  /** i18n key 前缀，用于状态文本，例如 'customNodes.constraintRules.rangeConstraintNode' */
  statusI18nPrefix: string
  /** 自定义 validationStatus 计算（如 Unique 从 errors 推导） */
  getValidationStatus?: (data: TData) => string
  /** 自定义状态文本计算（如 Scripted 的 disabled 状态） */
  getStatusText?: (data: TData, validationStatus: string) => string | undefined
  /** 删除确认弹窗 message 的 i18n key */
  deleteMessageKey?: string
}

export interface ConstraintNodeBaseResult {
  isSaving: Ref<boolean>
  validationStatus: ComputedRef<string>
  displayErrors: ComputedRef<string[]>
  errorCount: ComputedRef<number>
  showDetails: ComputedRef<boolean>
  statusText: ComputedRef<string>
  metrics: ComputedRef<Array<{ label: string; value: number }>>
  handleSave: () => Promise<void>
  handleDelete: (opts?: { onBeforeDelete?: () => boolean | Promise<boolean> }) => Promise<void>
}

export function useConstraintNodeBase<TData extends BaseConstraintNodeData>(
  props: { id: string; data: TData; selected?: boolean },
  options: ConstraintNodeBaseOptions<TData>
): ConstraintNodeBaseResult {
  const { t } = useI18n()
  const store = useGraphStore()
  const { showConfirm } = useGlobalConfirm()

  const isSaving = ref(false)

  const validationStatus = computed(() => {
    if (options.getValidationStatus) {
      return options.getValidationStatus(props.data) ?? 'idle'
    }
    return props.data.validationStatus || 'idle'
  })

  const displayErrors = computed(() => {
    if (validationStatus.value === 'missing') return []
    return (props.data.validationErrors || []).filter((msg): msg is string => !!msg)
  })

  const errorCount = computed(() => {
    const last = props.data.lastValidation
    if (last && typeof last.errorCount === 'number') return last.errorCount
    return 0
  })

  const showDetails = computed(() => {
    if (props.selected) return true
    if (validationStatus.value === 'error') return true
    return !!props.data.lastValidation || (props.data.validationErrors || []).length > 0
  })

  const prefix = options.statusI18nPrefix
  const statusText = computed((): string => {
    if (options.getStatusText) {
      const custom = options.getStatusText(props.data, validationStatus.value)
      if (custom !== undefined) return custom
    }
    const statusMap: Record<string, string> = {
      idle: t(`${prefix}.statusIdle`) ?? 'idle',
      pass: t(`${prefix}.statusPass`) ?? 'pass',
      error: t(`${prefix}.statusError`) ?? 'error',
      missing: t(`${prefix}.statusMissing`) ?? 'missing',
    }
    return statusMap[validationStatus.value] ?? statusMap.idle ?? 'idle'
  })

  const metrics = computed(() => {
    const last = props.data.lastValidation
    if (!last) return []
    return [
      { label: t('customNodes.constraintRules.totalRows', '总行数'), value: last.totalRows || 0 },
      { label: t('customNodes.constraintRules.matchCount', '匹配'), value: last.matchCount || 0 },
      { label: t('customNodes.constraintRules.errorCount', '错误'), value: last.errorCount || 0 },
    ]
  })

  const handleSave = async () => {
    if (isSaving.value) return
    isSaving.value = true
    try {
      await store.saveConstraintNode(props.id)
    } finally {
      isSaving.value = false
    }
  }

  const handleDelete = async (deleteOpts?: {
    onBeforeDelete?: () => boolean | Promise<boolean>
  }) => {
    const confirmed = await showConfirm({
      title: t('common.confirmDialog.title'),
      message: t(options.deleteMessageKey || 'common.confirmDialog.deleteConstraint'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      type: 'warning',
    })
    if (!confirmed) return
    if (deleteOpts?.onBeforeDelete) {
      const ok = await deleteOpts.onBeforeDelete()
      if (!ok) return
    }
    store.deleteNode(props.id)
  }

  return {
    isSaving,
    validationStatus,
    displayErrors,
    errorCount,
    showDetails,
    statusText,
    metrics,
    handleSave,
    handleDelete,
  }
}

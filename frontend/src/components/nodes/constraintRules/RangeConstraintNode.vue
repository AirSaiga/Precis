<!--
  @file RangeConstraintNode.vue
  @description 范围约束节点组件

  在可视化画布中配置范围约束，限制数值字段必须在指定的最小值和最大值之间。
-->
<template>
  <ConstraintNodeFrame
    class="range-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="purple"
    :state="resolveNodeState(validationStatus, selected)"
    :title="t('customNodes.constraintRules.rangeConstraintNode.title')"
    icon="📏"
    :help-text="t('customNodes.constraintRules.rangeConstraintNode.helpTooltip')"
    :error-count="errorCount"
    :show-save="true"
    :is-saving="isSaving"
    :delete-title="t('common.delete')"
    :error-title="t('common.error')"
    :save-title="t('common.save')"
    :save-text="t('common.save')"
    :saving-text="t('common.saving')"
    :handles="[
      {
        id: `target-input-${id}`,
        type: 'target',
        position: Position.Left,
        color: 'warning',
        title: t('customNodes.constraintRules.rangeConstraintNode.inputHandle'),
      },
    ]"
    @delete="handleDelete"
    @save="handleSave"
  >
    <ConstraintNodeLayout
      :status="validationStatus"
      :status-text="statusText"
      :error-count="errorCount"
      :show-details="showDetails"
    >
      <!-- 信息区：源和区间配置 -->
      <template #info>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.rangeConstraintNode.sourceLabel')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{ sourceDisplay }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.rangeConstraintNode.rangeLabel')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasRange }">{{ rangeSummary }}</span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.rangeConstraintNode.detailsTitle') }}
        </div>

        <div v-if="data.lastValidation" class="details-metrics">
          <div v-for="metric in metrics" :key="metric.label" class="metric">
            {{ metric.label }}: {{ metric.value }}
          </div>
        </div>

        <div v-if="displayErrors.length > 0" class="details-errors">
          <div v-for="(msg, idx) in displayErrors" :key="idx" class="details-error">
            {{ msg }}
          </div>
        </div>
        <div v-else class="details-empty">
          {{ t('customNodes.constraintRules.rangeConstraintNode.noDetails') }}
        </div>
      </template>
    </ConstraintNodeLayout>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed, ref, watch, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import NodeBadge from '@/components/ui/NodeBadge.vue'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { RangeConstraintNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'
  import {
    validateRange,
    type RangeValidationRequest,
    type ValidationResponse,
  } from '@/api/validationApi'
  import { getApiBaseUrl } from '@/core/services/httpClient'
  import { formatNumericValue } from '@/composables/nodes/constraints/useConstraintLayout'
  import { resolveValidationSource } from '@/composables/nodes/constraints/useValidationSource'
  import { tryInlineValidation } from '@/composables/nodes/constraints/tryInlineValidation'

  const props = defineProps<{
    id: string
    data: RangeConstraintNodeData
    selected?: boolean
  }>()

  const emit = defineEmits<{
    (e: 'schemaConnected', data: any): void
    (e: 'schemaDisconnected', data: any): void
    (e: 'validationCompleted', data: any): void
    (e: 'validationErrors', data: any): void
    (e: 'configUpdated', data: any): void
  }>()

  const { t } = useI18n()
  const store = useGraphStore()
  const { showConfirm } = useGlobalConfirm()

  const {
    isSaving,
    validationStatus,
    validationErrors,
    displayErrors,
    errorCount,
    showDetails,
    statusText,
    metrics,
    handleSave,
    handleDelete,
  } = useConstraintNodeBase(props, {
    statusI18nPrefix: 'customNodes.constraintRules.rangeConstraintNode',
  })

  // ===== 计算属性 =====

  const hasSource = computed(
    () => !!props.data.sourceRef?.nodeId && !!props.data.sourceRef?.columnId
  )
  const boundaryMode = computed(() => props.data.boundaryMode || 'inclusive')
  const hasRange = computed(
    () => props.data.minValue !== undefined || props.data.maxValue !== undefined
  )

  const sourceDisplay = computed(() => {
    if (!hasSource.value)
      return t('customNodes.constraintRules.rangeConstraintNode.waitingForSource')
    const table = props.data.table || ''
    const column = props.data.column || ''
    if (!table && !column)
      return t('customNodes.constraintRules.rangeConstraintNode.waitingForSource')
    return `${table}${table && column ? '.' : ''}${column}`
  })

  const rangeSummary = computed(() => {
    if (!hasRange.value) return t('customNodes.constraintRules.rangeConstraintNode.rangeEmpty')
    const min = props.data.minValue !== undefined ? String(props.data.minValue) : '-∞'
    const max = props.data.maxValue !== undefined ? String(props.data.maxValue) : '+∞'
    const boundary =
      boundaryMode.value === 'inclusive'
        ? t('customNodes.constraintRules.rangeConstraintNode.inclusive')
        : t('customNodes.constraintRules.rangeConstraintNode.exclusive')
    return `${min} ~ ${max} (${boundary})`
  })

  // ===== 校验逻辑 =====

  const performValidation = async () => {
    const emptyResult = {
      errorCount: 0,
      totalRows: 0,
      errors: [] as Array<{ row: number; value: unknown; message: string | undefined }>,
    }

    if (!hasSource.value || !hasRange.value) return emptyResult

    const source = resolveValidationSource(store, props.data.sourceRef)
    if (!source) {
      if (await tryInlineValidation(store, props.data.sourceRef, props.id)) return emptyResult
      store.updateNodeData(props.id, {
        validationStatus: 'missing',
        validationErrors: ['源表未连接数据源，无法执行区间校验'],
        lastValidation: undefined,
      })
      return emptyResult
    }

    const validationConfig = {
      min_value: props.data.minValue,
      max_value: props.data.maxValue,
      boundary_mode: boundaryMode.value,
    }

    try {
      const request: RangeValidationRequest = {
        validation_type: 'range',
        target_column_name: source.columnName,
        source_file_path: source.filePath,
        sheet_name: source.sheetName,
        header_row: source.headerRow,
        validation_config: validationConfig,
      }
      const response = await validateRange(request)

      if (!response.success || !response.data) {
        const status = 'error'
        store.updateNodeData(props.id, {
          validationStatus: status,
          validationErrors: response.error ? [String(response.error)] : ['区间校验失败'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const errorRows = response.data.error_rows || []
      const errorCountVal = errorRows.length
      const totalRows = response.data.total_rows || 0
      const matchCount = Math.max(0, totalRows - errorCountVal)

      const formattedErrors = errorRows.map((err: any) => {
        const formattedValue = formatNumericValue(err.cell_value)
        const minValue = formatNumericValue(props.data.minValue)
        const maxValue = formatNumericValue(props.data.maxValue)
        const message =
          err.error_message ||
          `区间约束冲突：值 ${formattedValue} 不在范围 [${minValue}, ${maxValue}] 内。`
        return { row: err.row_index, value: err.cell_value, formattedValue, message }
      })

      store.updateNodeData(props.id, {
        validationStatus: errorCountVal > 0 ? 'error' : 'pass',
        validationErrors: formattedErrors.map((e) => e.message),
        lastValidation: { totalRows, errorCount: errorCountVal, matchCount },
      })

      return { errorCount: errorCountVal, totalRows, errors: formattedErrors }
    } catch (error) {
      logger.error('Range validation failed:', error)
      store.updateNodeData(props.id, {
        validationStatus: 'error',
        validationErrors: [String(error)],
      })
      return emptyResult
    }
  }

  // ===== 事件处理 =====

  const validateNow = async () => {
    await nextTick()
    await performValidation()
  }

  let validationTimer: number | undefined
  const scheduleValidation = () => {
    if (validationTimer) window.clearTimeout(validationTimer)
    validationTimer = window.setTimeout(() => {
      validateNow().catch(() => undefined)
    }, 300)
  }

  // ===== Watchers =====

  watch(
    () => props.data.sourceRef?.columnId,
    (next) => {
      if (next && hasRange.value) {
        scheduleValidation()
      }
    },
    { immediate: true }
  )

  watch(
    () => [props.data.minValue, props.data.maxValue, props.data.boundaryMode].join('\u0000'),
    () => {
      if (hasSource.value) {
        scheduleValidation()
      }
    }
  )
</script>

<style scoped src="./RangeConstraintNode.styles.css"></style>

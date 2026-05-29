<!--
  @file DateLogicConstraintNode.vue
  @description 日期逻辑约束节点组件

  在可视化画布中配置日期逻辑约束，支持日期范围、日期比较等逻辑校验规则。
-->
<template>
  <ConstraintNodeFrame
    class="datelogic-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="pink"
    :state="resolveNodeState(validationStatus, selected)"
    :title="t('customNodes.constraintRules.dateLogicConstraintNode.title')"
    icon="📅"
    :help-text="t('customNodes.constraintRules.dateLogicConstraintNode.helpTooltip')"
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
        title: t('customNodes.constraintRules.dateLogicConstraintNode.inputHandle'),
      },
    ]"
    @delete="handleDelete"
    @save="handleSave"
  >
    <ConstraintNodeLayout
      :status="validationStatus"
      :status-text="statusText"
      :error-count="errorCount"
      :show-guide="selected"
      :show-details="showDetails"
    >
      <!-- 信息区：源和模式 -->
      <template #info>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.dateLogicConstraintNode.sourceLabel')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{ sourceDisplay }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.dateLogicConstraintNode.modeLabel')
          }}</span>
          <span class="info-value">{{ modeSummary }}</span>
        </div>
      </template>

      <!-- 预览区：配置摘要 -->
      <template #preview>
        <div v-if="!hasConfig" class="preview-empty">
          {{ t('customNodes.constraintRules.dateLogicConstraintNode.editInInspectorToConfig') }}
        </div>
        <div v-else class="preview-content">
          <span class="config-badge">{{ configSummary }}</span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.dateLogicConstraintNode.detailsTitle') }}
        </div>
        <div v-if="data.lastValidation" class="details-metrics">
          <div class="metric">
            {{ t('customNodes.constraintRules.dateLogicConstraintNode.totalRows') }}:
            {{ data.lastValidation.totalRows || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.dateLogicConstraintNode.matchCount') }}:
            {{ data.lastValidation.matchCount || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.dateLogicConstraintNode.errorCount') }}:
            {{ data.lastValidation.errorCount || 0 }}
          </div>
        </div>

        <div v-if="displayErrors.length > 0" class="details-errors">
          <div v-for="(msg, idx) in displayErrors" :key="idx" class="details-error">
            {{ msg }}
          </div>
        </div>
        <div v-else class="details-empty">
          {{ t('customNodes.constraintRules.dateLogicConstraintNode.noDetails') }}
        </div>
      </template>
    </ConstraintNodeLayout>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed, nextTick, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import NodeBadge from '@/components/ui/NodeBadge.vue'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { DateLogicConstraintNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'
  import { useConstraintSourceSelector } from '@/composables/nodes/constraints/useConstraintSourceSelector'
  import { resolveValidationSource } from '@/composables/nodes/constraints/useValidationSource'
  import { tryInlineValidation } from '@/composables/nodes/constraints/tryInlineValidation'
  import { getApiBaseUrl } from '@/core/services/httpClient'
  import { isUUID } from '@/shared/isUUID'

  const props = defineProps<{
    id: string
    data: DateLogicConstraintNodeData
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
    statusI18nPrefix: 'customNodes.constraintRules.dateLogicConstraintNode',
  })

  const localLogicMode = ref<'compare' | 'calculation'>(props.data.logicMode || 'compare')
  const localCompareOp = ref<'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'range'>(
    props.data.compareOp || 'gt'
  )
  const localCalculationType = ref<'age' | 'days_diff'>(props.data.calculationType || 'age')
  const localReferenceType = ref<'date' | 'column'>(props.data.referenceDate ? 'date' : 'column')
  const localReferenceDate = ref(props.data.referenceDate || '')
  const localReferenceColumn = ref(props.data.referenceColumn || '')
  const localTargetType = ref<'value' | 'column'>(props.data.targetValue ? 'value' : 'column')
  const localTargetValue = ref(props.data.targetValue || '')
  const localTargetColumn = ref(props.data.targetColumn || '')

  const validateNow = async () => {
    await nextTick()
    await performValidation()
  }

  const {
    localSourceNodeId,
    localSourceColumnId,
    availableSourceTables,
    availableSourceColumns,
    handleSourceTableChange,
    handleSourceColumnChange,
  } = useConstraintSourceSelector(props, {
    onSourceColumnChange: validateNow,
  })

  const hasSource = computed(
    () => !!props.data.sourceRef?.nodeId && !!props.data.sourceRef?.columnId
  )
  const hasConfig = computed(() => {
    if (localLogicMode.value === 'compare') {
      if (localReferenceType.value === 'date') return !!localReferenceDate.value
      return !!localReferenceColumn.value
    } else {
      if (localTargetType.value === 'value') return !!localTargetValue.value
      return !!localTargetColumn.value
    }
  })

  const sourceDisplay = computed(() => {
    if (!hasSource.value)
      return t('customNodes.constraintRules.dateLogicConstraintNode.waitingForSource')
    const table = props.data.table || ''
    const column = props.data.column || ''
    if (!table && !column)
      return t('customNodes.constraintRules.dateLogicConstraintNode.waitingForSource')
    return `${table}${table && column ? '.' : ''}${column}`
  })

  const modeSummary = computed(() => {
    const mode = localLogicMode.value
    if (mode === 'compare') {
      const op = localCompareOp.value
      const opText =
        op === 'gt' ? '>' : op === 'lt' ? '<' : op === 'eq' ? '=' : op === 'gte' ? '>=' : '<='
      if (localReferenceType.value === 'date') {
        return `${t('customNodes.constraintRules.dateLogicConstraintNode.modeCompare')} ${opText} ${localReferenceDate.value || '-'}`
      }
      return `${t('customNodes.constraintRules.dateLogicConstraintNode.modeCompare')} ${opText} ${localReferenceColumn.value || '-'}`
    } else {
      const calc = localCalculationType.value
      if (calc === 'age') {
        return t('customNodes.constraintRules.dateLogicConstraintNode.calcAge')
      }
      return t('customNodes.constraintRules.dateLogicConstraintNode.calcDaysDiff')
    }
  })

  const configSummary = computed(() => {
    const mode = localLogicMode.value
    if (mode === 'compare') {
      const op = localCompareOp.value
      const opText =
        op === 'gt'
          ? '>'
          : op === 'lt'
            ? '<'
            : op === 'eq'
              ? '='
              : op === 'gte'
                ? '>='
                : op === 'lte'
                  ? '<='
                  : op
      const compareType =
        localReferenceType.value === 'date'
          ? t('customNodes.constraintRules.dateLogicConstraintNode.refTypeDate')
          : t('customNodes.constraintRules.dateLogicConstraintNode.refTypeColumn')
      const target =
        localReferenceType.value === 'date'
          ? localReferenceDate.value || '-'
          : localReferenceColumn.value || '-'
      return `${t('customNodes.constraintRules.dateLogicConstraintNode.modeCompare')} ${opText} ${target} (${compareType})`
    } else {
      const calcType =
        localCalculationType.value === 'age'
          ? t('customNodes.constraintRules.dateLogicConstraintNode.calcAge')
          : t('customNodes.constraintRules.dateLogicConstraintNode.calcDaysDiff')
      const targetType =
        localTargetType.value === 'value'
          ? t('customNodes.constraintRules.dateLogicConstraintNode.targetTypeValue')
          : t('customNodes.constraintRules.dateLogicConstraintNode.targetTypeColumn')
      const target =
        localTargetType.value === 'value'
          ? localTargetValue.value || '-'
          : localTargetColumn.value || '-'
      return `${calcType}: ${target} (${targetType})`
    }
  })

  const showGuide = computed(() => {
    if (validationStatus.value === 'error') return false
    return !hasSource.value || !hasConfig.value
  })

  const performValidation = async () => {
    const emptyResult = {
      errorCount: 0,
      totalRows: 0,
      errors: [] as Array<{ row: number; value: unknown; message: string | undefined }>,
    }

    if (!hasSource.value || !hasConfig.value) return emptyResult

    const source = resolveValidationSource(store, props.data.sourceRef)
    if (!source) {
      if (await tryInlineValidation(store, props.data.sourceRef, props.id)) return emptyResult
      store.updateNodeData(props.id, {
        validationStatus: 'missing',
        validationErrors: ['源表未连接数据源，无法执行日期逻辑校验'],
        lastValidation: undefined,
      })
      return emptyResult
    }

    const validationConfig: Record<string, any> = {
      logic_mode: localLogicMode.value,
    }

    if (localLogicMode.value === 'compare') {
      validationConfig.compare_op = localCompareOp.value
      if (localReferenceType.value === 'date') {
        validationConfig.reference_date = localReferenceDate.value
      } else {
        validationConfig.reference_column = localReferenceColumn.value
      }
    } else {
      validationConfig.calculation_type = localCalculationType.value
      if (localTargetType.value === 'value') {
        validationConfig.target_value = localTargetValue.value
      } else {
        validationConfig.target_column = localTargetColumn.value
      }
    }

    try {
      const request = {
        validation_type: 'date_logic',
        target_column_name: source.columnName,
        source_file_path: source.filePath,
        sheet_name: source.sheetName,
        header_row: source.headerRow,
        validation_config: validationConfig,
      }

      const fetchResponse = await fetch(`${getApiBaseUrl()}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const response = await fetchResponse.json()

      if (!response.success || !response.data) {
        const status = 'error'
        store.updateNodeData(props.id, {
          validationStatus: status,
          validationErrors: response.error ? [String(response.error)] : ['日期逻辑校验失败'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const errorRows = response.data.error_rows || []
      const errorCountVal = errorRows.length
      const totalRows = response.data.total_rows || 0
      const matchCount = Math.max(0, totalRows - errorCountVal)

      const formattedErrors = errorRows.map((err: any) => {
        const message = err.error_message || `日期逻辑约束冲突`
        return {
          row: err.row_index,
          value: err.cell_value,
          message,
        }
      })

      store.updateNodeData(props.id, {
        validationStatus: errorCountVal > 0 ? 'error' : 'pass',
        validationErrors: formattedErrors.map((e) => e.message),
        lastValidation: {
          totalRows,
          errorCount: errorCountVal,
          matchCount,
        },
      })

      return { errorCount: errorCountVal, totalRows, errors: formattedErrors }
    } catch (error) {
      logger.error('DateLogic validation failed:', error)
      store.updateNodeData(props.id, {
        validationStatus: 'error',
        validationErrors: [String(error)],
      })
      return emptyResult
    }
  }

  let validationTimer: number | undefined
  const scheduleValidation = () => {
    if (validationTimer) window.clearTimeout(validationTimer)
    validationTimer = window.setTimeout(() => {
      validateNow().catch(() => undefined)
    }, 300)
  }

  const handleLogicModeChange = () => {
    updateConfig()
    scheduleValidation()
  }

  const handleConfigChange = () => {
    updateConfig()
    scheduleValidation()
  }

  const updateConfig = () => {
    const updateData: any = {
      logicMode: localLogicMode.value,
    }

    if (localLogicMode.value === 'compare') {
      updateData.compareOp = localCompareOp.value
      if (localReferenceType.value === 'date') {
        updateData.referenceDate = localReferenceDate.value
        updateData.referenceColumn = undefined
      } else {
        updateData.referenceColumn = localReferenceColumn.value
        updateData.referenceDate = undefined
      }
    } else {
      updateData.calculationType = localCalculationType.value
      if (localTargetType.value === 'value') {
        updateData.targetValue = localTargetValue.value
        updateData.targetColumn = undefined
      } else {
        updateData.targetColumn = localTargetColumn.value
        updateData.targetValue = undefined
      }
    }

    store.updateNodeData(props.id, updateData)
  }

  watch(
    () => props.data.sourceRef?.columnId,
    (next) => {
      if (next && hasConfig.value) {
        scheduleValidation()
      }
    }
  )

  watch(
    () => props.data.logicMode,
    (next) => {
      localLogicMode.value = next || 'compare'
    }
  )

  watch(
    () => props.data.compareOp,
    (next) => {
      localCompareOp.value = next || 'gt'
    }
  )

  watch(
    () => props.data.calculationType,
    (next) => {
      localCalculationType.value = next || 'age'
    }
  )
</script>

<style scoped src="./DateLogicConstraintNode.styles.css"></style>

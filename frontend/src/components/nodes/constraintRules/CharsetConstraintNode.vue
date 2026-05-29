<!--
  @file CharsetConstraintNode.vue
  @description 字符集约束节点组件

  在可视化画布中配置字符集约束，限制字段内容必须符合指定的字符编码规则。
-->
<template>
  <ConstraintNodeFrame
    class="charset-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="pink"
    :state="resolveNodeState(validationStatus, selected)"
    :title="t('customNodes.constraintRules.charsetConstraintNode.title')"
    icon="🔤"
    :help-text="t('customNodes.constraintRules.charsetConstraintNode.helpTooltip')"
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
        title: t('customNodes.constraintRules.charsetConstraintNode.inputHandle'),
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
            t('customNodes.constraintRules.charsetConstraintNode.sourceLabel', '源')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{
            data.table ||
            t('customNodes.constraintRules.charsetConstraintNode.waitingForSource')
          }}</span>
        </div>
        <div v-if="hasSource && data.column" class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.charsetConstraintNode.columnLabel', '列')
          }}</span>
          <span class="info-value">{{ data.column }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.charsetConstraintNode.modeLabel')
          }}</span>
          <span class="info-value">{{ modeSummary }}</span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.charsetConstraintNode.detailsTitle') }}
        </div>
        <div v-if="data.lastValidation" class="details-metrics">
          <div class="metric">
            {{ t('customNodes.constraintRules.charsetConstraintNode.totalRows') }}:
            {{ data.lastValidation.totalRows || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.charsetConstraintNode.matchCount') }}:
            {{ data.lastValidation.matchCount || 0 }}
          </div>
          <div class="metric">
            {{ t('customNodes.constraintRules.charsetConstraintNode.errorCount') }}:
            {{ data.lastValidation.errorCount || 0 }}
          </div>
        </div>

        <div v-if="displayErrors.length > 0" class="details-errors">
          <div v-for="(msg, idx) in displayErrors" :key="idx" class="details-error">
            {{ msg }}
          </div>
        </div>
        <div v-else class="details-empty">
          {{ t('customNodes.constraintRules.charsetConstraintNode.noDetails') }}
        </div>
      </template>
    </ConstraintNodeLayout>

    <!-- 手动校验按钮区 -->
    <div class="charset-validate-section">
      <button
        class="charset-validate-btn"
        :disabled="!hasSource || isValidating"
        :title="
          !hasSource
            ? t('customNodes.constraintRules.charsetConstraintNode.waitingForSource')
            : t('customNodes.constraintRules.charsetConstraintNode.validate')
        "
        @mousedown.stop
        @click.stop="handleValidate"
      >
        {{
          isValidating
            ? t('customNodes.constraintRules.charsetConstraintNode.validating')
            : t('customNodes.constraintRules.charsetConstraintNode.validate')
        }}
      </button>
    </div>
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
  import type { CharsetConstraintNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'
  import { useConstraintSourceSelector } from '@/composables/nodes/constraints/useConstraintSourceSelector'
  import { resolveValidationSource } from '@/composables/nodes/constraints/useValidationSource'
  import { tryInlineValidation } from '@/composables/nodes/constraints/tryInlineValidation'
  import {
    validateCharset,
    type CharsetValidationRequest,
    type ValidationResponse,
  } from '@/api/validationApi'
  import { getApiBaseUrl } from '@/core/services/httpClient'
  import { useToast } from '@/composables/shared/useToast'

  const props = defineProps<{
    id: string
    data: CharsetConstraintNodeData
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
  const toast = useToast()
  const showSuccess = toast.success
  const showError = toast.error

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
    statusI18nPrefix: 'customNodes.constraintRules.charsetConstraintNode',
  })

  const isValidating = ref(false)

  const localCharsetMode = ref<'ascii' | 'chinese'>(props.data.charsetMode || 'ascii')

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
  const hasMode = computed(() => !!localCharsetMode.value)

  const sourceDisplay = computed(() => {
    if (!hasSource.value)
      return t('customNodes.constraintRules.charsetConstraintNode.waitingForSource')
    const table = props.data.table || ''
    const column = props.data.column || ''
    if (!table && !column)
      return t('customNodes.constraintRules.charsetConstraintNode.waitingForSource')
    return `${table}${table && column ? '.' : ''}${column}`
  })

  const modeSummary = computed(() => {
    const mode = localCharsetMode.value
    return mode === 'ascii'
      ? t('customNodes.constraintRules.charsetConstraintNode.modeAscii')
      : t('customNodes.constraintRules.charsetConstraintNode.modeChinese')
  })

  const showGuide = computed(() => {
    if (validationStatus.value === 'error') return false
    return !hasSource.value || !hasMode.value
  })

  const performValidation = async () => {
    const emptyResult = {
      errorCount: 0,
      totalRows: 0,
      errors: [] as Array<{ row: number; value: unknown; message: string | undefined }>,
    }

    if (!hasSource.value || !hasMode.value) return emptyResult

    const source = resolveValidationSource(store, props.data.sourceRef)
    if (!source) {
      if (await tryInlineValidation(store, props.data.sourceRef, props.id)) return emptyResult
      store.updateNodeData(props.id, {
        validationStatus: 'missing',
        validationErrors: ['源表未连接数据源，无法执行字符集校验'],
        lastValidation: undefined,
      })
      return emptyResult
    }

    const validationConfig = {
      charset_mode: localCharsetMode.value,
    }

    try {
      const request: CharsetValidationRequest = {
        validation_type: 'charset',
        target_column_name: source.columnName,
        source_file_path: source.filePath,
        sheet_name: source.sheetName,
        header_row: source.headerRow,
        validation_config: validationConfig,
      }

      const response = await validateCharset(request)

      if (!response.success || !response.data) {
        const status = 'error'
        store.updateNodeData(props.id, {
          validationStatus: status,
          validationErrors: response.error ? [String(response.error)] : ['字符集校验失败'],
          lastValidation: undefined,
        })
        return emptyResult
      }

      const errorRows = response.data.error_rows || []
      const errorCountVal = errorRows.length
      const totalRows = response.data.total_rows || 0
      const matchCount = Math.max(0, totalRows - errorCountVal)

      const formattedErrors = errorRows.map((err: any) => {
        const message = err.error_message || `字符集约束冲突：值包含非允许字符`
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

      // 显示校验结果反馈
      if (errorCountVal > 0) {
        showError(
          t(
            'customNodes.constraintRules.charsetConstraintNode.validationFailed',
            '字符集校验未通过'
          ),
          t(
            'customNodes.constraintRules.charsetConstraintNode.errorCountMessage',
            { count: errorCountVal },
            `发现 ${errorCountVal} 条不符合约束的数据`
          )
        )
      } else {
        showSuccess(
          t('customNodes.constraintRules.charsetConstraintNode.validationPassed', '字符集校验通过'),
          t(
            'customNodes.constraintRules.charsetConstraintNode.allRowsMatch',
            { count: totalRows },
            `全部 ${totalRows} 行数据符合字符集约束`
          )
        )
      }

      return { errorCount: errorCountVal, totalRows, errors: formattedErrors }
    } catch (error) {
      logger.error('Charset validation failed:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      store.updateNodeData(props.id, {
        validationStatus: 'error',
        validationErrors: [errorMessage],
      })
      showError(
        t('customNodes.constraintRules.charsetConstraintNode.validationError', '校验执行失败'),
        errorMessage
      )
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

  const handleModeChange = () => {
    store.updateNodeData(props.id, {
      charsetMode: localCharsetMode.value,
    } as unknown as Partial<CharsetConstraintNodeData>)
    scheduleValidation()
  }

  const handleValidate = async () => {
    if (isValidating.value) return
    isValidating.value = true
    try {
      await validateNow()
    } finally {
      isValidating.value = false
    }
  }

  watch(
    () => props.data.sourceRef?.columnId,
    (next) => {
      if (next && hasMode.value) {
        scheduleValidation()
      }
    }
  )

  watch(
    () => props.data.charsetMode,
    (next) => {
      localCharsetMode.value = next || 'ascii'
    }
  )
</script>

<style scoped src="./CharsetConstraintNode.styles.css"></style>

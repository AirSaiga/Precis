<!--
  @file DateLogicConstraintNode.vue
  @description 日期逻辑约束节点组件

  在可视化画布中配置日期逻辑约束，支持日期范围、日期比较等逻辑校验规则。
-->
<template>
  <ConstraintNodeFrame
    class="datelogic-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="teal"
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
            t('customNodes.constraintRules.dateLogicConstraintNode.sourceLabel', '源')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{
            data.table || t('customNodes.constraintRules.dateLogicConstraintNode.waitingForSource')
          }}</span>
        </div>
        <div v-if="hasSource && data.column" class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.dateLogicConstraintNode.columnLabel', '列')
          }}</span>
          <span class="info-value">{{ data.column }}</span>
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
  import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { DateLogicConstraintNodeData } from '@/types/graph'
  import { useGraphStore } from '@/stores/graphStore'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'
  import { validateConstraintNodeById } from '@/services/constraints/validationRegistry'
  const props = defineProps<{
    id: string
    data: DateLogicConstraintNodeData
    selected?: boolean
  }>()

  defineEmits<{
    (e: 'schemaConnected', payload: { nodeId: string; columnId?: string }): void
    (e: 'schemaDisconnected', payload: { nodeId: string; columnId?: string }): void
    (e: 'validationCompleted', payload: { nodeId: string; status: string }): void
    (e: 'validationErrors', payload: { nodeId: string; errors: string[] }): void
    (e: 'configUpdated', payload: { nodeId: string; patch: Record<string, unknown> }): void
  }>()

  const { t } = useI18n()
  const store = useGraphStore()

  const {
    isSaving,
    validationStatus,
    displayErrors,
    errorCount,
    showDetails,
    statusText,
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

  const performValidation = async () => {
    if (!hasSource.value || !hasConfig.value) return
    await validateConstraintNodeById(props.id, store.nodes, store.edges, store.updateNodeData)
  }

  let validationTimer: number | undefined
  onBeforeUnmount(() => {
    if (validationTimer) clearTimeout(validationTimer)
  })
  const scheduleValidation = () => {
    if (validationTimer) window.clearTimeout(validationTimer)
    validationTimer = window.setTimeout(() => {
      validateNow().catch(() => undefined)
    }, 300)
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

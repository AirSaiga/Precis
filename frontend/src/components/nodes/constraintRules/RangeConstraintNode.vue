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
            t('customNodes.constraintRules.rangeConstraintNode.sourceLabel', '源')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{
            data.table || t('customNodes.constraintRules.rangeConstraintNode.waitingForSource')
          }}</span>
        </div>
        <div v-if="hasSource && data.column" class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.rangeConstraintNode.columnLabel', '列')
          }}</span>
          <span class="info-value">{{ data.column }}</span>
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
  import { computed, onBeforeUnmount, ref, watch, nextTick } from 'vue'
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
  import { validateConstraintNodeById } from '@/services/constraints/validationRegistry'

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
    if (!hasSource.value || !hasRange.value) return
    await validateConstraintNodeById(props.id, store.nodes, store.edges, store.updateNodeData)
  }

  // ===== 事件处理 =====

  const validateNow = async () => {
    await nextTick()
    await performValidation()
  }

  let validationTimer: number | undefined
  onBeforeUnmount(() => { if (validationTimer) clearTimeout(validationTimer) })
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

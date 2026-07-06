<!--
  @file AllowedValuesConstraintNode.vue
  @description 允许值约束节点组件

  在可视化画布中配置允许值约束，限制字段只能取特定的预设值。
-->
<template>
  <ConstraintNodeFrame
    class="allowed-values-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="sky"
    :state="resolveNodeState(validationStatus, selected)"
    :title="t('customNodes.constraintRules.allowedValuesConstraintNode.title')"
    icon-name="constraint-allowedValues"
    :help-text="t('customNodes.constraintRules.allowedValuesConstraintNode.helpTooltip')"
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
        title: t('customNodes.constraintRules.allowedValuesConstraintNode.inputHandle'),
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
      <!-- 信息区 -->
      <template #info>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.allowedValuesConstraintNode.sourceLabel', '源')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{
            data.table ||
            t('customNodes.constraintRules.allowedValuesConstraintNode.waitingForSource')
          }}</span>
        </div>
        <div v-if="hasSource && data.column" class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.allowedValuesConstraintNode.columnLabel', '列')
          }}</span>
          <span class="info-value">{{ data.column }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.allowedValuesConstraintNode.allowedValuesLabel')
          }}</span>
          <span class="info-value" :class="{ placeholder: allowedValuesArray.length === 0 }">{{
            allowedValuesSummary
          }}</span>
        </div>
      </template>

      <!-- 预览区：允许值标签 -->
      <template #preview>
        <div v-if="allowedValuesArray.length === 0" class="preview-empty">
          {{ t('customNodes.constraintRules.allowedValuesConstraintNode.editInInspectorToAdd') }}
        </div>
        <div v-else class="preview-tags">
          <span v-for="value in displayValues" :key="value" class="preview-tag">
            {{ value }}
          </span>
          <span v-if="remainingCount > 0" class="preview-tag more"> +{{ remainingCount }} </span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.allowedValuesConstraintNode.detailsTitle') }}
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
          {{ t('customNodes.constraintRules.allowedValuesConstraintNode.noDetails') }}
        </div>
      </template>
    </ConstraintNodeLayout>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { computed, onBeforeUnmount, watch, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { AllowedValuesConstraintNodeData } from '@/types/graph'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'
  import { useGraphStore } from '@/stores/graphStore'
  import { validateConstraintNodeById } from '@/services/constraints/validationRegistry'
  const props = defineProps<{
    id: string
    data: AllowedValuesConstraintNodeData
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

  const performValidation = async () => {
    await validateConstraintNodeById(props.id, store.nodes, store.edges, store.updateNodeData)
  }

  const {
    isSaving,
    validationStatus,
    displayErrors,
    errorCount,
    showDetails,
    statusText,
    metrics,
    handleSave,
    handleDelete,
  } = useConstraintNodeBase(props, {
    statusI18nPrefix: 'customNodes.constraintRules.allowedValuesConstraintNode',
  })

  // ===== 计算属性 =====

  const allowedValuesArray = computed(() =>
    Array.from(props.data.allowedValues || []).map((v) => String(v))
  )
  const hasSource = computed(
    () => !!props.data.sourceRef?.nodeId && !!props.data.sourceRef?.columnId
  )

  const allowedValuesSummary = computed(() => {
    if (allowedValuesArray.value.length === 0)
      return t('customNodes.constraintRules.allowedValuesConstraintNode.allowedValuesEmpty')
    const preview = allowedValuesArray.value.slice(0, 5)
    const rest = Math.max(0, allowedValuesArray.value.length - preview.length)
    return rest > 0
      ? `${preview.join(', ')} ${t('customNodes.constraintRules.allowedValuesConstraintNode.moreCount', { count: rest })}`
      : preview.join(', ')
  })

  // 最多显示8个标签
  const MAX_DISPLAY_TAGS = 8
  const displayValues = computed(() => allowedValuesArray.value.slice(0, MAX_DISPLAY_TAGS))
  const remainingCount = computed(() =>
    Math.max(0, allowedValuesArray.value.length - MAX_DISPLAY_TAGS)
  )

  // ===== 校验调度 =====

  const validateNow = async () => {
    await nextTick()
    await performValidation().catch(() => undefined)
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

  // ===== Watchers =====

  watch(
    () => props.data.sourceRef?.columnId,
    (next) => {
      if (next && allowedValuesArray.value.length > 0) {
        scheduleValidation()
      }
    },
    { immediate: true }
  )

  watch(
    () => allowedValuesArray.value.join('\u0000'),
    () => {
      if (hasSource.value) {
        scheduleValidation()
      }
    }
  )
</script>

<style scoped src="./AllowedValuesConstraintNode.styles.css"></style>

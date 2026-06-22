/** * @file NotNullConstraintNode.vue * @description 非空约束节点组件 * * 核心功能： * -
配置非空约束规则 * - 接收 Schema 节点列的输入 * - 执行非空校验（检查指定列是否存在空值） * -
显示校验状态和错误行数 * * 数据流： * Schema列 → [target Handle] → NotNullConstraintNode → 校验结果
*/
<template>
  <ConstraintNodeFrame
    class="not-null-constraint-node constraint-node"
    :class="['status-' + validationStatus, { 'is-selected': selected }]"
    theme="danger"
    :state="resolveNodeState(validationStatus, selected)"
    :title="t('customNodes.constraintRules.notNullConstraintNode.title')"
    icon="🚫"
    :help-text="t('customNodes.constraintRules.notNullConstraintNode.helpTooltip')"
    :error-count="errorCount"
    :show-save="true"
    :is-saving="isSaving"
    :delete-title="t('common.delete')"
    :error-title="t('common.error')"
    :save-title="t('common.save')"
    :save-text="t('common.save')"
    :saving-text="t('common.saving')"
    :shell-title="shellTitle"
    :handles="[
      {
        id: `target-input-${id}`,
        type: 'target',
        position: Position.Left,
        color: 'warning',
        title: t('customNodes.constraintRules.constraintHandle.title'),
      },
    ]"
    @delete="handleDelete"
    @save="handleSave"
    @error-click="handleErrorClick"
  >
    <ConstraintNodeLayout
      :status="validationStatus"
      :status-text="statusText"
      :error-count="errorCount"
      :show-details="showDetails"
      compact
    >
      <!-- 信息区 -->
      <template #info>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.notNullConstraintNode.sourceLabel', '源')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{ tableDisplay }}</span>
        </div>
        <div v-if="hasSource && data.column" class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.notNullConstraintNode.columnLabel', '列')
          }}</span>
          <span class="info-value">{{ data.column }}</span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.notNullConstraintNode.detailsTitle', '校验详情') }}
        </div>

        <div v-if="data.lastValidation" class="details-metrics">
          <div v-for="metric in metrics" :key="metric.label" class="metric">
            {{ metric.label }}: {{ metric.value }}
          </div>
        </div>

        <div v-if="displayErrors.length > 0" class="details-errors">
          <div v-for="(msg, idx) in displayErrors.slice(0, 5)" :key="idx" class="details-error">
            {{ msg }}
          </div>
          <div v-if="displayErrors.length > 5" class="details-more">
            +{{ displayErrors.length - 5 }}
            {{ t('customNodes.constraintRules.moreErrors', '更多错误...') }}
          </div>
        </div>
        <div v-else class="details-empty">
          {{ t('customNodes.constraintRules.notNullConstraintNode.noDetails', '暂无详情') }}
        </div>
      </template>
    </ConstraintNodeLayout>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { NotNullConstraintNodeData } from '@/types/graph'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'
  const props = defineProps<{
    id: string
    data: NotNullConstraintNodeData
    selected?: boolean
  }>()

  const emit = defineEmits<{
    (e: 'data-update', data: Partial<NotNullConstraintNodeData>): void
    (e: 'error-click'): void
  }>()

  const { t } = useI18n()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const { showConfirm } = useGlobalConfirm()

  const {
    isSaving,
    validationStatus,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
    validationErrors,
    displayErrors,
    errorCount,
    showDetails,
    statusText,
    metrics,
    handleSave,
    handleDelete,
  } = useConstraintNodeBase(props, {
    statusI18nPrefix: 'customNodes.constraintRules.notNullConstraintNode',
  })

  // ===== 计算属性 =====

  const hasSource = computed(() => !!props.data.table)

  const tableDisplay = computed(() => {
    if (!hasSource.value)
      return t('customNodes.constraintRules.notNullConstraintNode.waitingForSource', '等待连接源列')
    return props.data.table
  })

  const shellTitle = computed(() => {
    if (!props.data.table || !props.data.column) return undefined
    return `${t('customNodes.constraintRules.constraint')}: ${props.data.table}.${props.data.column}`
  })

  const handleErrorClick = () => {
    emit('error-click')
  }
</script>

<style scoped src="./NotNullConstraintNode.styles.css"></style>

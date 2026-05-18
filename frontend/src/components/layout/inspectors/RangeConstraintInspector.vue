<!--
  @file RangeConstraintInspector.vue
  @description 范围约束属性检查器
-->
<template>
  <div class="range-constraint-inspector">
    <BaseInspector
      :title="t('inspector.constraint.range.title')"
      :badge="t('inspector.constraint.range.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.range.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.range.constraintNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.minValue') }}</label>
        <input
          type="number"
          :value="data.minValue"
          @input="updateData({ minValue: ($event.target as HTMLInputElement).valueAsNumber })"
          class="editable-input"
          :placeholder="t('inspector.constraint.range.minValuePlaceholder')"
          step="any"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.maxValue') }}</label>
        <input
          type="number"
          :value="data.maxValue"
          @input="updateData({ maxValue: ($event.target as HTMLInputElement).valueAsNumber })"
          class="editable-input"
          :placeholder="t('inspector.constraint.range.maxValuePlaceholder')"
          step="any"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.boundaryMode') }}</label>
        <select
          :value="data.boundaryMode || 'inclusive'"
          @change="
            updateData({
              boundaryMode: ($event.target as HTMLSelectElement).value as 'inclusive' | 'exclusive',
            })
          "
          class="editable-select"
        >
          <option value="inclusive">{{ t('inspector.constraint.range.inclusive') }}</option>
          <option value="exclusive">{{ t('inspector.constraint.range.exclusive') }}</option>
        </select>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.range.targetColumn')"
      :badge="t('inspector.constraint.range.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.table') }}</label>
        <div class="readonly-value">{{ data.table || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.column') }}</label>
        <div class="readonly-value">{{ data.column || '-' }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.range.sourceConnection')"
      :badge="t('inspector.constraint.range.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.connectionStatus') }}</label>
        <div class="status-indicator" :class="connectionStatus">
          <span class="status-icon">{{ connectionStatus === 'connected' ? '✓' : '✗' }}</span>
          <span class="status-text">{{
            connectionStatus === 'connected'
              ? t('inspector.constraint.range.connected')
              : t('inspector.constraint.range.notConnected')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.nodeId">
        <label>{{ t('inspector.constraint.range.sourceNodeId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.nodeId }}</div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.columnId">
        <label>{{ t('inspector.constraint.range.sourceColumnId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.columnId }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.range.validationStatus')"
      :badge="t('inspector.constraint.range.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.range.status') }}</label>
        <div class="status-badge" :class="validationStatusClass">
          {{ validationStatusText }}
        </div>
      </div>
      <div v-if="data.lastValidation" class="validation-metrics">
        <div class="metric-row">
          <span class="metric-label">{{ t('inspector.constraint.range.totalRows') }}:</span>
          <span class="metric-value">{{ data.lastValidation.totalRows || 0 }}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">{{ t('inspector.constraint.range.matchCount') }}:</span>
          <span class="metric-value">{{ data.lastValidation.matchCount || 0 }}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">{{ t('inspector.constraint.range.errorCount') }}:</span>
          <span class="metric-value error">{{ data.lastValidation.errorCount || 0 }}</span>
        </div>
      </div>
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import type { RangeConstraintNodeData } from '@/types/graph'

  const props = defineProps<{
    data: RangeConstraintNodeData
  }>()

  const emit = defineEmits<{
    (e: 'update', data: Partial<RangeConstraintNodeData>): void
  }>()

  const { t } = useI18n()

  const updateData = (data: Partial<RangeConstraintNodeData>) => {
    emit('update', data)
  }

  const connectionStatus = computed(() => {
    return props.data.sourceRef?.nodeId && props.data.sourceRef?.columnId
      ? 'connected'
      : 'disconnected'
  })

  const validationStatusClass = computed(() => {
    const status = props.data.validationStatus || 'idle'
    return `status-${status}`
  })

  const validationStatusText = computed(() => {
    const statusMap: Record<string, string> = {
      idle: t('inspector.constraint.range.statusIdle'),
      pass: t('inspector.constraint.range.statusPass'),
      error: t('inspector.constraint.range.statusError'),
      missing: t('inspector.constraint.range.statusMissing'),
    }
    return statusMap[props.data.validationStatus || 'idle']
  })
</script>

<style scoped src="./RangeConstraintInspector.styles.css"></style>

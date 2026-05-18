<!--
  @file AllowedValuesConstraintInspector.vue
  @description 允许值约束属性检查器
-->
<template>
  <div class="allowed-values-constraint-inspector">
    <BaseInspector
      :title="t('inspector.constraint.allowedValues.title')"
      :badge="t('inspector.constraint.allowedValues.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.allowedValues.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.allowedValues.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.allowedValues.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.allowedValues.constraintNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.allowedValues.allowedValues') }}</label>
        <div class="allowed-values-list">
          <div v-for="(value, index) in allowedValuesArray" :key="index" class="value-item">
            <span class="value-text">{{ value }}</span>
            <button class="remove-btn" @click="removeValue(index)">×</button>
          </div>
          <div class="add-value">
            <input
              type="text"
              v-model="newValue"
              @keyup.enter="addValue"
              class="editable-input"
              :placeholder="t('inspector.constraint.allowedValues.addValuePlaceholder')"
            />
            <button class="add-btn" @click="addValue">+</button>
          </div>
        </div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.allowedValues.targetColumn')"
      :badge="t('inspector.constraint.allowedValues.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.allowedValues.table') }}</label>
        <div class="readonly-value">{{ data.table || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.allowedValues.column') }}</label>
        <div class="readonly-value">{{ data.column || '-' }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.allowedValues.sourceConnection')"
      :badge="t('inspector.constraint.allowedValues.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.allowedValues.connectionStatus') }}</label>
        <div class="status-indicator" :class="connectionStatus">
          <span class="status-icon">{{ connectionStatus === 'connected' ? '✓' : '✗' }}</span>
          <span class="status-text">{{
            connectionStatus === 'connected'
              ? t('inspector.constraint.allowedValues.connected')
              : t('inspector.constraint.allowedValues.notConnected')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.nodeId">
        <label>{{ t('inspector.constraint.allowedValues.sourceNodeId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.nodeId }}</div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.columnId">
        <label>{{ t('inspector.constraint.allowedValues.sourceColumnId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.columnId }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.allowedValues.validationStatus')"
      :badge="t('inspector.constraint.allowedValues.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.allowedValues.status') }}</label>
        <div class="status-badge" :class="validationStatusClass">
          {{ validationStatusText }}
        </div>
      </div>
      <div class="validation-stats" v-if="data.lastValidation">
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.allowedValues.totalRows') }}</span>
          <span class="stat-value">{{ data.lastValidation.totalRows }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.allowedValues.matchCount') }}</span>
          <span class="stat-value">{{ data.lastValidation.matchCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.allowedValues.errorCount') }}</span>
          <span class="stat-value error">{{ data.lastValidation.errorCount }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.validationErrors && data.validationErrors.length > 0">
        <label>{{ t('inspector.constraint.allowedValues.errorMessages') }}</label>
        <div class="error-list">
          <div
            v-for="(error, index) in data.validationErrors.slice(0, 5)"
            :key="index"
            class="error-item"
          >
            {{ error }}
          </div>
          <div v-if="data.validationErrors.length > 5" class="error-more">
            {{
              t('inspector.constraint.allowedValues.moreErrors', {
                count: data.validationErrors.length - 5,
              })
            }}
          </div>
        </div>
      </div>
    </BaseInspector>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed } from 'vue'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import type { AllowedValuesConstraintNodeData } from '@/types/constraints'
  import { useI18n } from 'vue-i18n'

  interface Props {
    data: AllowedValuesConstraintNodeData
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  const emit = defineEmits<{
    'update:data': [data: Partial<AllowedValuesConstraintNodeData>]
  }>()

  const newValue = ref('')

  function updateData(newData: Partial<AllowedValuesConstraintNodeData>) {
    emit('update:data', newData)
  }

  const allowedValuesArray = computed(() => {
    if (!props.data.allowedValues) return []
    if (props.data.allowedValues instanceof Set) {
      return Array.from(props.data.allowedValues)
    }
    return props.data.allowedValues
  })

  function addValue() {
    if (newValue.value.trim()) {
      const currentValues = allowedValuesArray.value
      updateData({ allowedValues: new Set([...currentValues, newValue.value.trim()]) })
      newValue.value = ''
    }
  }

  function removeValue(index: number) {
    const currentValues = [...allowedValuesArray.value]
    currentValues.splice(index, 1)
    updateData({ allowedValues: new Set(currentValues) })
  }

  const connectionStatus = computed(() => {
    if (props.data.sourceRef?.nodeId && props.data.sourceRef?.columnId) {
      return 'connected'
    }
    return 'not-connected'
  })

  const validationStatusClass = computed(() => {
    switch (props.data.validationStatus) {
      case 'pass':
        return 'status-pass'
      case 'error':
        return 'status-error'
      case 'missing':
        return 'status-missing'
      default:
        return 'status-idle'
    }
  })

  const validationStatusText = computed(() => {
    switch (props.data.validationStatus) {
      case 'pass':
        return t('inspector.constraint.allowedValues.statusPass')
      case 'error':
        return t('inspector.constraint.allowedValues.statusError')
      case 'missing':
        return t('inspector.constraint.allowedValues.statusMissing')
      default:
        return t('inspector.constraint.allowedValues.statusIdle')
    }
  })
</script>

<style scoped src="./AllowedValuesConstraintInspector.styles.css"></style>

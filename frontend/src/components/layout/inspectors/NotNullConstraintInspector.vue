<!--
  @file NotNullConstraintInspector.vue
  @description 非空约束属性检查器
-->
<template>
  <div class="not-null-constraint-inspector">
    <BaseInspector
      :title="t('inspector.constraint.notNull.title')"
      :badge="t('inspector.constraint.notNull.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.notNull.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.notNull.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.notNull.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.notNull.constraintNamePlaceholder')"
        />
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.notNull.targetColumn')"
      :badge="t('inspector.constraint.notNull.badgeReadOnly')"
      badge-class="read-only"
    >
      <InspectorField
        :label="t('inspector.constraint.notNull.table')"
        :model-value="data.table || '-'"
        :editable="false"
      />
      <InspectorField
        :label="t('inspector.constraint.notNull.column')"
        :model-value="data.column || '-'"
        :editable="false"
      />
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.notNull.sourceConnection')"
      :badge="t('inspector.constraint.notNull.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.notNull.connectionStatus') }}</label>
        <div class="status-indicator" :class="connectionStatus">
          <span class="status-icon">{{ connectionStatus === 'connected' ? '✓' : '✗' }}</span>
          <span class="status-text">{{
            connectionStatus === 'connected'
              ? t('inspector.constraint.notNull.connected')
              : t('inspector.constraint.notNull.notConnected')
          }}</span>
        </div>
      </div>
      <InspectorField
        v-if="data.sourceRef?.nodeId"
        :label="t('inspector.constraint.notNull.sourceNodeId')"
        :model-value="data.sourceRef.nodeId"
        :editable="false"
      />
      <InspectorField
        v-if="data.sourceRef?.columnId"
        :label="t('inspector.constraint.notNull.sourceColumnId')"
        :model-value="data.sourceRef.columnId"
        :editable="false"
      />
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.notNull.validationStatus')"
      :badge="t('inspector.constraint.notNull.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.notNull.status') }}</label>
        <div class="status-badge" :class="validationStatusClass">
          {{ validationStatusText }}
        </div>
      </div>
      <div class="form-group" v-if="data.validationErrors && data.validationErrors.length > 0">
        <label>{{ t('inspector.constraint.notNull.errorCount') }}</label>
        <div class="readonly-value error-count">{{ data.validationErrors.length }}</div>
      </div>
      <div
        class="validation-errors"
        v-if="data.validationErrors && data.validationErrors.length > 0"
      >
        <label>{{ t('inspector.constraint.notNull.errorMessages') }}</label>
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
              t('inspector.constraint.notNull.moreErrors', {
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
  import { computed } from 'vue'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'
  import type { NotNullConstraintNodeData } from '@/types/constraints'
  import { useI18n } from 'vue-i18n'

  interface Props {
    data: NotNullConstraintNodeData
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  const emit = defineEmits<{
    'update:data': [data: Partial<NotNullConstraintNodeData>]
  }>()

  function updateData(newData: Partial<NotNullConstraintNodeData>) {
    emit('update:data', newData)
  }

  const connectionStatus = computed(() => {
    if (props.data.sourceRef?.nodeId && props.data.sourceRef?.columnId) {
      return 'connected'
    }
    return 'not-connected'
  })

  const validationStatusClass = computed(() => {
    if (props.data.validationErrors && props.data.validationErrors.length > 0) {
      return 'status-error'
    }
    return 'status-pass'
  })

  const validationStatusText = computed(() => {
    if (props.data.validationErrors && props.data.validationErrors.length > 0) {
      return t('inspector.constraint.notNull.statusError')
    }
    return t('inspector.constraint.notNull.statusPass')
  })
</script>

<style scoped src="./NotNullConstraintInspector.styles.css"></style>

<!--
  @file UniqueConstraintInspector.vue
  @description 唯一性约束属性检查器
-->
<template>
  <div class="unique-constraint-inspector">
    <BaseInspector
      :title="t('inspector.constraint.unique.title')"
      :badge="t('inspector.constraint.unique.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.unique.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.unique.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.unique.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.unique.constraintNamePlaceholder')"
        />
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.unique.targetColumns')"
      :badge="t('inspector.constraint.unique.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.unique.table') }}</label>
        <div class="readonly-value">{{ data.table || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.unique.columns') }}</label>
        <div class="columns-list" v-if="data.column">
          <div class="column-item">
            <span class="column-index">1</span>
            <span class="column-name">{{ data.column }}</span>
          </div>
        </div>
        <div class="readonly-value" v-else>-</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.unique.sourceConnection')"
      :badge="t('inspector.constraint.unique.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.unique.connectionStatus') }}</label>
        <div class="status-indicator" :class="connectionStatus">
          <span class="status-icon">{{ connectionStatus === 'connected' ? '✓' : '✗' }}</span>
          <span class="status-text">{{
            connectionStatus === 'connected'
              ? t('inspector.constraint.unique.connected')
              : t('inspector.constraint.unique.notConnected')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.nodeId">
        <label>{{ t('inspector.constraint.unique.sourceNodeId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.nodeId }}</div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.columnId">
        <label>{{ t('inspector.constraint.unique.sourceColumnIds') }}</label>
        <div class="columns-list">
          <div class="column-item">
            <span class="column-index">1</span>
            <span class="column-name">{{ data.sourceRef.columnId }}</span>
          </div>
        </div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.unique.validationStatus')"
      :badge="t('inspector.constraint.unique.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.unique.status') }}</label>
        <div class="status-badge" :class="validationStatusClass">
          {{ validationStatusText }}
        </div>
      </div>
      <div class="form-group" v-if="data.validationErrors && data.validationErrors.length > 0">
        <label>{{ t('inspector.constraint.unique.errorCount') }}</label>
        <div class="readonly-value error-count">{{ data.validationErrors.length }}</div>
      </div>
      <div
        class="validation-errors"
        v-if="data.validationErrors && data.validationErrors.length > 0"
      >
        <label>{{ t('inspector.constraint.unique.errorMessages') }}</label>
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
              t('inspector.constraint.unique.moreErrors', {
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
  import type { UniqueConstraintNodeData } from '@/types/constraints'
  import { useI18n } from 'vue-i18n'

  interface Props {
    data: UniqueConstraintNodeData
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  const emit = defineEmits<{
    'update:data': [data: Partial<UniqueConstraintNodeData>]
  }>()

  function updateData(newData: Partial<UniqueConstraintNodeData>) {
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
      return t('inspector.constraint.unique.statusError')
    }
    return t('inspector.constraint.unique.statusPass')
  })
</script>

<style scoped src="./UniqueConstraintInspector.styles.css"></style>

<!--
  @file CharsetConstraintInspector.vue
  @description 字符集约束属性检查器
-->
<template>
  <div class="charset-constraint-inspector">
    <BaseInspector
      :title="t('inspector.constraint.charset.title')"
      :badge="t('inspector.constraint.charset.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.charset.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.charset.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.charset.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.charset.constraintNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.charset.charsetMode') }}</label>
        <select
          :value="data.charsetMode || 'ascii'"
          @change="
            updateData({
              charsetMode: ($event.target as HTMLSelectElement).value as 'ascii' | 'chinese',
            })
          "
          class="editable-select"
        >
          <option value="ascii">{{ t('inspector.constraint.charset.ascii') }}</option>
          <option value="chinese">{{ t('inspector.constraint.charset.chinese') }}</option>
        </select>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.charset.targetColumn')"
      :badge="t('inspector.constraint.charset.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.charset.table') }}</label>
        <div class="readonly-value">{{ data.table || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.charset.column') }}</label>
        <div class="readonly-value">{{ data.column || '-' }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.charset.sourceConnection')"
      :badge="t('inspector.constraint.charset.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.charset.connectionStatus') }}</label>
        <div class="status-indicator" :class="connectionStatus">
          <span class="status-icon">{{ connectionStatus === 'connected' ? '✓' : '✗' }}</span>
          <span class="status-text">{{
            connectionStatus === 'connected'
              ? t('inspector.constraint.charset.connected')
              : t('inspector.constraint.charset.notConnected')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.nodeId">
        <label>{{ t('inspector.constraint.charset.sourceNodeId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.nodeId }}</div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.columnId">
        <label>{{ t('inspector.constraint.charset.sourceColumnId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.columnId }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      v-if="data.validationStatus && data.validationStatus !== 'idle'"
      :title="t('inspector.constraint.charset.validationResult')"
      :badge="t('inspector.constraint.charset.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.charset.status') }}</label>
        <div class="status-indicator" :class="data.validationStatus">
          <span class="status-text">{{
            data.validationStatus === 'pass'
              ? t('inspector.constraint.charset.pass')
              : data.validationStatus === 'error'
                ? t('inspector.constraint.charset.error')
                : t('inspector.constraint.charset.unknown')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.lastValidation?.totalRows !== undefined">
        <label>{{ t('inspector.constraint.charset.totalRows') }}</label>
        <div class="readonly-value">{{ data.lastValidation.totalRows }}</div>
      </div>
      <div class="form-group" v-if="data.lastValidation?.matchCount !== undefined">
        <label>{{ t('inspector.constraint.charset.matchCount') }}</label>
        <div class="readonly-value">{{ data.lastValidation.matchCount }}</div>
      </div>
      <div class="form-group" v-if="data.validationErrors && data.validationErrors.length > 0">
        <label>{{ t('inspector.constraint.charset.errors') }}</label>
        <div class="error-list">
          <div
            v-for="(err, idx) in data.validationErrors.slice(0, 5)"
            :key="idx"
            class="error-item"
          >
            {{ err }}
          </div>
          <div v-if="data.validationErrors.length > 5" class="error-more">
            {{
              t('inspector.constraint.charset.moreErrors', {
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
  import { useI18n } from 'vue-i18n'
  import BaseInspector from './BaseInspector.vue'
  import { InspectorField } from '@/components/ui/inspector'

  const { t } = useI18n()

  const props = defineProps<{
    data: {
      configName?: string
      constraintName?: string
      table?: string
      column?: string
      charsetMode?: 'ascii' | 'chinese'
      sourceRef?: {
        nodeId?: string
        columnId?: string
      }
      validationStatus?: 'idle' | 'pass' | 'error' | 'missing'
      lastValidation?: {
        totalRows?: number
        matchCount?: number
        errorCount?: number
      }
      validationErrors?: string[]
    }
    nodeId: string
    nodeType: string
  }>()

  const emit = defineEmits<{
    'update:data': [data: Record<string, unknown>]
  }>()

  const updateData = (data: Record<string, unknown>) => {
    emit('update:data', data)
  }

  const connectionStatus = computed(() => {
    if (props.data.sourceRef?.nodeId && props.data.sourceRef?.columnId) {
      return 'connected'
    }
    return 'not-connected'
  })
</script>

<style scoped src="./CharsetConstraintInspector.styles.css"></style>

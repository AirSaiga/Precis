<!--
  @file ScriptedConstraintInspector.vue
  @description 脚本约束属性检查器
-->
<template>
  <div class="scripted-constraint-inspector">
    <BaseInspector
      :title="t('inspector.constraint.scripted.title')"
      :badge="t('inspector.constraint.scripted.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.scripted.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.scripted.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.scripted.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.scripted.constraintNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.scripted.scriptName') }}</label>
        <input
          type="text"
          :value="data.scriptName"
          @input="updateData({ scriptName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.scripted.scriptNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.scripted.script') }}</label>
        <div class="script-editor">
          <textarea
            :value="data.script"
            @input="updateData({ script: ($event.target as HTMLTextAreaElement).value })"
            class="editable-textarea"
            :placeholder="t('inspector.constraint.scripted.scriptPlaceholder')"
            rows="5"
          ></textarea>
          <div class="script-hint">
            {{ t('inspector.constraint.scripted.scriptHint') }}
          </div>
        </div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.scripted.targetColumn')"
      :badge="t('inspector.constraint.scripted.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.scripted.table') }}</label>
        <div class="readonly-value">{{ data.table || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.scripted.column') }}</label>
        <div class="readonly-value" v-if="data.columns && data.columns.length > 0">
          <div class="columns-list">
            <div v-for="(col, index) in data.columns" :key="index" class="column-item">
              <span class="column-index">{{ index + 1 }}</span>
              <span class="column-name">{{ col }}</span>
            </div>
          </div>
        </div>
        <div class="readonly-value" v-else>{{ data.column || '-' }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.scripted.sourceConnection')"
      :badge="t('inspector.constraint.scripted.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.scripted.connectionStatus') }}</label>
        <div class="status-indicator" :class="connectionStatus">
          <span class="status-icon">{{ connectionStatus === 'connected' ? '✓' : '✗' }}</span>
          <span class="status-text">{{
            connectionStatus === 'connected'
              ? t('inspector.constraint.scripted.connected')
              : t('inspector.constraint.scripted.notConnected')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.nodeId">
        <label>{{ t('inspector.constraint.scripted.sourceNodeId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.nodeId }}</div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.columnId">
        <label>{{ t('inspector.constraint.scripted.sourceColumnId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.columnId }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.scripted.validationStatus')"
      :badge="t('inspector.constraint.scripted.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.scripted.status') }}</label>
        <div class="status-badge" :class="validationStatusClass">
          {{ validationStatusText }}
        </div>
      </div>
      <div class="validation-stats" v-if="data.lastValidation">
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.scripted.totalRows') }}</span>
          <span class="stat-value">{{ data.lastValidation.totalRows }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.scripted.matchCount') }}</span>
          <span class="stat-value">{{ data.lastValidation.matchCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.scripted.errorCount') }}</span>
          <span class="stat-value error">{{ data.lastValidation.errorCount }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.validationErrors && data.validationErrors.length > 0">
        <label>{{ t('inspector.constraint.scripted.errorMessages') }}</label>
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
              t('inspector.constraint.scripted.moreErrors', {
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
  import type { ScriptedConstraintNodeData } from '@/types/constraints'
  import { useI18n } from 'vue-i18n'

  interface Props {
    data: ScriptedConstraintNodeData
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  const emit = defineEmits<{
    'update:data': [data: Partial<ScriptedConstraintNodeData>]
  }>()

  function updateData(newData: Partial<ScriptedConstraintNodeData>) {
    emit('update:data', newData)
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
        return t('inspector.constraint.scripted.statusPass')
      case 'error':
        return t('inspector.constraint.scripted.statusError')
      case 'missing':
        return t('inspector.constraint.scripted.statusMissing')
      default:
        return t('inspector.constraint.scripted.statusIdle')
    }
  })
</script>

<style scoped src="./ScriptedConstraintInspector.styles.css"></style>

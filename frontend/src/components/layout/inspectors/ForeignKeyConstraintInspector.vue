<!--
  @file ForeignKeyConstraintInspector.vue
  @description 外键约束属性检查器

  显示和编辑外键约束节点的属性：
  - 配置名称、约束名称
  - 规则类型（EXIST_IN / REFERENCE_FROM）
  - 源表/源列和目标表/目标列
  - 是否允许空值
  - 高级过滤条件
-->

<template>
  <div class="foreign-key-constraint-inspector">
    <BaseInspector
      :title="t('inspector.constraint.foreignKey.title')"
      :badge="t('inspector.constraint.foreignKey.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.foreignKey.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.foreignKey.constraintNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.ruleType') }}</label>
        <select
          :value="data.config?.ruleType || 'EXIST_IN'"
          @change="
            updateData({
              config: {
                ...data.config,
                ruleType: ($event.target as HTMLSelectElement).value as
                  | 'EXIST_IN'
                  | 'REFERENCE_FROM',
              },
            })
          "
          class="editable-select"
        >
          <option value="EXIST_IN">{{ t('inspector.constraint.foreignKey.ruleExistIn') }}</option>
          <option value="REFERENCE_FROM">
            {{ t('inspector.constraint.foreignKey.ruleReferenceFrom') }}
          </option>
        </select>
      </div>
      <div class="form-group">
        <label>
          <input
            type="checkbox"
            :checked="data.allowNull"
            @change="updateData({ allowNull: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('inspector.constraint.foreignKey.allowNull') }}
        </label>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.foreignKey.targetColumn')"
      :badge="t('inspector.constraint.foreignKey.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.sourceTable') }}</label>
        <div class="readonly-value">{{ data.sourceTable || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.sourceColumn') }}</label>
        <div class="readonly-value">{{ data.sourceColumn || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.targetTable') }}</label>
        <div class="readonly-value">{{ data.targetTable || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.targetColumn') }}</label>
        <div class="readonly-value">{{ data.targetColumn || '-' }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.foreignKey.sourceConnection')"
      :badge="t('inspector.constraint.foreignKey.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.connectionStatus') }}</label>
        <div class="status-indicator" :class="connectionStatus">
          <span class="status-icon">{{ connectionStatus === 'connected' ? '✓' : '✗' }}</span>
          <span class="status-text">{{
            connectionStatus === 'connected'
              ? t('inspector.constraint.foreignKey.connected')
              : t('inspector.constraint.foreignKey.notConnected')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.sourceInfo?.label">
        <label>{{ t('inspector.constraint.foreignKey.sourceInfoLabel') }}</label>
        <div class="readonly-value">{{ data.sourceInfo.label }}</div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.nodeId">
        <label>{{ t('inspector.constraint.foreignKey.sourceNodeId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.nodeId }}</div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.columnId">
        <label>{{ t('inspector.constraint.foreignKey.sourceColumnId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.columnId }}</div>
      </div>
      <div class="form-group" v-if="data.targetRef?.nodeId">
        <label>{{ t('inspector.constraint.foreignKey.targetNodeId') }}</label>
        <div class="readonly-value">{{ data.targetRef.nodeId }}</div>
      </div>
      <div class="form-group" v-if="data.targetRef?.columnId">
        <label>{{ t('inspector.constraint.foreignKey.targetColumnId') }}</label>
        <div class="readonly-value">{{ data.targetRef.columnId }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.foreignKey.validationStatus')"
      :badge="t('inspector.constraint.foreignKey.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.foreignKey.status') }}</label>
        <div class="status-badge" :class="validationStatusClass">
          {{ validationStatusText }}
        </div>
      </div>
      <div class="validation-stats" v-if="data.lastValidation">
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.foreignKey.totalRows') }}</span>
          <span class="stat-value">{{ data.lastValidation.totalRows }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.foreignKey.matchCount') }}</span>
          <span class="stat-value">{{ data.lastValidation.matchCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.foreignKey.errorCount') }}</span>
          <span class="stat-value error">{{ data.lastValidation.errorCount }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.validationErrors && data.validationErrors.length > 0">
        <label>{{ t('inspector.constraint.foreignKey.errorMessages') }}</label>
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
              t('inspector.constraint.foreignKey.moreErrors', {
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
  import type { ForeignKeyConstraintNodeData } from '@/types/constraints'
  import { useI18n } from 'vue-i18n'

  interface Props {
    data: ForeignKeyConstraintNodeData
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  const emit = defineEmits<{
    'update:data': [data: Partial<ForeignKeyConstraintNodeData>]
  }>()

  function updateData(newData: Partial<ForeignKeyConstraintNodeData>) {
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
        return t('inspector.constraint.foreignKey.statusPass')
      case 'error':
        return t('inspector.constraint.foreignKey.statusError')
      case 'missing':
        return t('inspector.constraint.foreignKey.statusMissing')
      default:
        return t('inspector.constraint.foreignKey.statusIdle')
    }
  })
</script>

<style scoped src="./ForeignKeyConstraintInspector.styles.css"></style>

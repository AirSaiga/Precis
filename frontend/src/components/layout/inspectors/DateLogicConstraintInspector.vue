<!--
  @file DateLogicConstraintInspector.vue
  @description 日期逻辑约束属性检查器
-->
<template>
  <div class="date-logic-constraint-inspector">
    <BaseInspector
      :title="t('inspector.constraint.dateLogic.title')"
      :badge="t('inspector.constraint.dateLogic.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.dateLogic.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.dateLogic.constraintNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.logicMode') }}</label>
        <select
          :value="data.logicMode || 'compare'"
          @change="
            updateData({
              logicMode: ($event.target as HTMLSelectElement).value as 'compare' | 'calculation',
            })
          "
          class="editable-select"
        >
          <option value="compare">{{ t('inspector.constraint.dateLogic.compareMode') }}</option>
          <option value="calculation">
            {{ t('inspector.constraint.dateLogic.calculationMode') }}
          </option>
        </select>
      </div>

      <template v-if="data.logicMode === 'compare'">
        <div class="form-group">
          <label>{{ t('inspector.constraint.dateLogic.compareOp') }}</label>
          <select
            :value="data.compareOp || 'gt'"
            @change="updateData({ compareOp: ($event.target as HTMLSelectElement).value })"
            class="editable-select"
          >
            <option value="gt">{{ t('inspector.constraint.dateLogic.gt') }}</option>
            <option value="lt">{{ t('inspector.constraint.dateLogic.lt') }}</option>
            <option value="eq">{{ t('inspector.constraint.dateLogic.eq') }}</option>
            <option value="gte">{{ t('inspector.constraint.dateLogic.gte') }}</option>
            <option value="lte">{{ t('inspector.constraint.dateLogic.lte') }}</option>
          </select>
        </div>
      </template>

      <template v-if="data.logicMode === 'calculation'">
        <div class="form-group">
          <label>{{ t('inspector.constraint.dateLogic.calculationType') }}</label>
          <select
            :value="data.calculationType || 'age'"
            @change="
              updateData({
                calculationType: ($event.target as HTMLSelectElement).value as 'age' | 'days_diff',
              })
            "
            class="editable-select"
          >
            <option value="age">{{ t('inspector.constraint.dateLogic.age') }}</option>
            <option value="days_diff">{{ t('inspector.constraint.dateLogic.daysDiff') }}</option>
          </select>
        </div>
      </template>

      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.referenceType') }}</label>
        <select
          :value="data.referenceDate ? 'date' : 'column'"
          @change="handleReferenceTypeChange"
          class="editable-select"
        >
          <option value="date">{{ t('inspector.constraint.dateLogic.fixedDate') }}</option>
          <option value="column">{{ t('inspector.constraint.dateLogic.referenceColumn') }}</option>
        </select>
      </div>

      <template v-if="data.referenceDate">
        <div class="form-group">
          <label>{{ t('inspector.constraint.dateLogic.referenceDate') }}</label>
          <input
            type="date"
            :value="data.referenceDate"
            @input="updateData({ referenceDate: ($event.target as HTMLInputElement).value })"
            class="editable-input"
          />
        </div>
      </template>

      <template v-if="data.referenceColumn">
        <div class="form-group">
          <label>{{ t('inspector.constraint.dateLogic.referenceColumn') }}</label>
          <input
            type="text"
            :value="data.referenceColumn"
            @input="updateData({ referenceColumn: ($event.target as HTMLInputElement).value })"
            class="editable-input"
            :placeholder="t('inspector.constraint.dateLogic.referenceColumnPlaceholder')"
          />
        </div>
      </template>

      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.targetValue') }}</label>
        <input
          type="text"
          :value="data.targetValue"
          @input="updateData({ targetValue: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.dateLogic.targetValuePlaceholder')"
        />
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.dateLogic.targetColumn')"
      :badge="t('inspector.constraint.dateLogic.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.table') }}</label>
        <div class="readonly-value">{{ data.table || '-' }}</div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.column') }}</label>
        <div class="readonly-value">{{ data.column || '-' }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      :title="t('inspector.constraint.dateLogic.sourceConnection')"
      :badge="t('inspector.constraint.dateLogic.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.connectionStatus') }}</label>
        <div class="status-indicator" :class="connectionStatus">
          <span class="status-icon">{{ connectionStatus === 'connected' ? '✓' : '✗' }}</span>
          <span class="status-text">{{
            connectionStatus === 'connected'
              ? t('inspector.constraint.dateLogic.connected')
              : t('inspector.constraint.dateLogic.notConnected')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.nodeId">
        <label>{{ t('inspector.constraint.dateLogic.sourceNodeId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.nodeId }}</div>
      </div>
      <div class="form-group" v-if="data.sourceRef?.columnId">
        <label>{{ t('inspector.constraint.dateLogic.sourceColumnId') }}</label>
        <div class="readonly-value">{{ data.sourceRef.columnId }}</div>
      </div>
    </BaseInspector>

    <BaseInspector
      v-if="data.validationStatus && data.validationStatus !== 'idle'"
      :title="t('inspector.constraint.dateLogic.validationResult')"
      :badge="t('inspector.constraint.dateLogic.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.dateLogic.status') }}</label>
        <div class="status-indicator" :class="data.validationStatus">
          <span class="status-text">{{
            data.validationStatus === 'pass'
              ? t('inspector.constraint.dateLogic.pass')
              : data.validationStatus === 'error'
                ? t('inspector.constraint.dateLogic.error')
                : t('inspector.constraint.dateLogic.unknown')
          }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.lastValidation?.totalRows !== undefined">
        <label>{{ t('inspector.constraint.dateLogic.totalRows') }}</label>
        <div class="readonly-value">{{ data.lastValidation.totalRows }}</div>
      </div>
      <div class="form-group" v-if="data.lastValidation?.matchCount !== undefined">
        <label>{{ t('inspector.constraint.dateLogic.matchCount') }}</label>
        <div class="readonly-value">{{ data.lastValidation.matchCount }}</div>
      </div>
      <div class="form-group" v-if="data.validationErrors && data.validationErrors.length > 0">
        <label>{{ t('inspector.constraint.dateLogic.errors') }}</label>
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
              t('inspector.constraint.dateLogic.moreErrors', {
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
      logicMode?: 'compare' | 'calculation'
      compareOp?: string
      calculationType?: 'age' | 'days_diff'
      referenceDate?: string
      referenceColumn?: string
      targetValue?: string
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

  const handleReferenceTypeChange = (event: Event) => {
    const value = (event.target as HTMLSelectElement).value
    if (value === 'date') {
      updateData({ referenceDate: '', referenceColumn: undefined })
    } else {
      updateData({ referenceDate: undefined, referenceColumn: '' })
    }
  }

  const connectionStatus = computed(() => {
    if (props.data.sourceRef?.nodeId && props.data.sourceRef?.columnId) {
      return 'connected'
    }
    return 'not-connected'
  })
</script>

<style scoped src="./DateLogicConstraintInspector.styles.css"></style>

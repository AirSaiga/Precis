<!--
  @file ConditionalConstraintInspector.vue
  @description 条件约束属性检查器（重构版）

  设计原则：
  - IF/THEN 列通过画布连线配置，Inspector 只读显示连接状态
  - THEN 条件配置可视化：值比较 / 列间比较(ref_column) / 非空
  - 支持"无条件触发"模式（跳过 IF，直接对所有行执行 THEN 检查）
-->
<template>
  <div class="conditional-constraint-inspector">
    <!-- 1. 基础配置 -->
    <BaseInspector
      :title="t('inspector.constraint.conditional.title')"
      :badge="t('inspector.constraint.conditional.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.conditional.configName') }}</label>
        <input
          type="text"
          :value="data.configName"
          @input="updateData({ configName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.conditional.configNamePlaceholder')"
        />
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.conditional.constraintName') }}</label>
        <input
          type="text"
          :value="data.constraintName"
          @input="updateData({ constraintName: ($event.target as HTMLInputElement).value })"
          class="editable-input"
          :placeholder="t('inspector.constraint.conditional.constraintNamePlaceholder')"
        />
      </div>
    </BaseInspector>

    <!-- 2. 连接状态（只读） -->
    <BaseInspector
      :title="t('inspector.constraint.conditional.targetColumns')"
      :badge="t('inspector.constraint.conditional.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.conditional.thenColumn') }}</label>
        <div class="readonly-value" :class="{ placeholder: !thenColumnDisplay }">
          {{ thenColumnDisplay || t('inspector.constraint.conditional.waitingForThenColumn') }}
        </div>
      </div>
      <div class="form-group">
        <label>{{ t('inspector.constraint.conditional.ifColumn') }}</label>
        <div class="readonly-value" :class="{ placeholder: !ifColumnDisplay }">
          {{ ifColumnDisplay || t('inspector.constraint.conditional.waitingForIfColumn') }}
        </div>
      </div>
    </BaseInspector>

    <!-- 3. IF 条件模式 -->
    <BaseInspector
      :title="t('inspector.constraint.conditional.ifModeTitle')"
      :badge="t('inspector.constraint.conditional.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group form-group-row">
        <label>{{ t('inspector.constraint.conditional.skipIfCondition') }}</label>
        <input type="checkbox" :checked="data.skipIfCondition" @change="toggleSkipIf" />
      </div>
      <div v-if="!data.skipIfCondition" class="form-group">
        <span class="field-hint">{{ t('inspector.constraint.conditional.connectIfHint') }}</span>
      </div>
    </BaseInspector>

    <!-- 4. THEN 条件配置 -->
    <BaseInspector
      :title="t('inspector.constraint.conditional.thenConditionTitle')"
      :badge="t('inspector.constraint.conditional.badgeEditable')"
      badge-class="editable"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.conditional.thenConditionType') }}</label>
        <select class="editable-select" :value="thenMode" @change="handleThenModeChange">
          <option value="value">{{ t('inspector.constraint.conditional.thenModeValue') }}</option>
          <option value="ref_column">
            {{ t('inspector.constraint.conditional.thenModeRefColumn') }}
          </option>
          <option value="not_null">{{ t('inspector.constraint.conditional.opNotNull') }}</option>
        </select>
      </div>

      <template v-if="thenMode !== 'not_null'">
        <div class="form-group">
          <label>{{ t('inspector.constraint.conditional.thenOperator') }}</label>
          <select class="editable-select" :value="thenOperator" @change="handleThenOperatorChange">
            <option value="eq">{{ t('inspector.constraint.conditional.opEq') }}</option>
            <option value="ne">{{ t('inspector.constraint.conditional.opNe') }}</option>
            <option value="gt">{{ t('inspector.constraint.conditional.opGt') }}</option>
            <option value="gte">{{ t('inspector.constraint.conditional.opGte') }}</option>
            <option value="lt">{{ t('inspector.constraint.conditional.opLt') }}</option>
            <option value="lte">{{ t('inspector.constraint.conditional.opLte') }}</option>
          </select>
        </div>

        <div v-if="thenMode === 'value'" class="form-group">
          <label>{{ t('inspector.constraint.conditional.thenValue') }}</label>
          <input
            type="text"
            class="editable-input"
            :value="thenValue"
            @blur="commitThenConfig"
            @keydown.enter="commitThenConfig"
            :placeholder="t('inspector.constraint.conditional.thenValuePlaceholder')"
          />
        </div>

        <div v-if="thenMode === 'ref_column'" class="form-group">
          <label>{{ t('inspector.constraint.conditional.thenRefColumn') }}</label>
          <input
            type="text"
            class="editable-input"
            :value="thenRefColumn"
            @blur="commitThenConfig"
            @keydown.enter="commitThenConfig"
            :placeholder="t('inspector.constraint.conditional.thenRefColumnPlaceholder')"
          />
          <span class="field-hint">{{
            t('inspector.constraint.conditional.thenRefColumnHelp')
          }}</span>
        </div>
      </template>

      <div v-if="thenMode === 'not_null'" class="form-group">
        <span class="field-hint">{{ t('inspector.constraint.conditional.thenNotNullHint') }}</span>
      </div>
    </BaseInspector>

    <!-- 5. 校验状态 -->
    <BaseInspector
      :title="t('inspector.constraint.conditional.validationStatus')"
      :badge="t('inspector.constraint.conditional.badgeReadOnly')"
      badge-class="read-only"
    >
      <div class="form-group">
        <label>{{ t('inspector.constraint.conditional.status') }}</label>
        <div class="status-badge" :class="validationStatusClass">
          {{ validationStatusText }}
        </div>
      </div>
      <div class="validation-stats" v-if="data.lastValidation">
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.conditional.totalRows') }}</span>
          <span class="stat-value">{{ data.lastValidation.totalRows }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.conditional.matchCount') }}</span>
          <span class="stat-value">{{ data.lastValidation.matchCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">{{ t('inspector.constraint.conditional.errorCount') }}</span>
          <span class="stat-value error">{{ data.lastValidation.errorCount }}</span>
        </div>
      </div>
      <div class="form-group" v-if="data.validationErrors && data.validationErrors.length > 0">
        <label>{{ t('inspector.constraint.conditional.errorMessages') }}</label>
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
              t('inspector.constraint.conditional.moreErrors', {
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
  import { computed, ref, watch } from 'vue'
  import BaseInspector from './BaseInspector.vue'
  import type { ConditionalConstraintNodeData } from '@/types/constraints'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'

  const props = defineProps<{
    data: ConditionalConstraintNodeData
  }>()

  const emit = defineEmits<{
    'update:data': [data: Partial<ConditionalConstraintNodeData>]
  }>()

  const { t } = useI18n()
  const store = useGraphStore()

  function updateData(newData: Partial<ConditionalConstraintNodeData>) {
    emit('update:data', newData)
  }

  // ============================================================================
  // 连接状态显示
  // ============================================================================

  const resolveColumnName = (nodeId?: string, columnId?: string): string => {
    if (!nodeId || !columnId) return ''
    const node = store.nodes.find((n) => n.id === nodeId)
    if (!node) return columnId
    if (node.type === 'schema') {
      const cols = (node.data as Record<string, unknown>).columns as
        | Array<{ id: string; columnName: string }>
        | undefined
      return cols?.find((c) => c.id === columnId)?.columnName || columnId
    }
    if (node.type === 'transformOutput') {
      return ((node.data as Record<string, unknown>).columnName as string) || columnId
    }
    return columnId
  }

  const thenColumnDisplay = computed(() => {
    const ref = props.data.thenRef
    if (!ref?.nodeId || !ref?.columnId) return ''
    return resolveColumnName(ref.nodeId, ref.columnId)
  })

  const ifColumnDisplay = computed(() => {
    const conditions = props.data.ifConditions
    if (Array.isArray(conditions) && conditions.length > 0) {
      const first = conditions[0]
      if (first?.ref?.nodeId && first?.ref?.columnId) {
        return resolveColumnName(first.ref.nodeId, first.ref.columnId)
      }
    }
    if (props.data.ifRef?.nodeId && props.data.ifRef?.columnId) {
      return resolveColumnName(props.data.ifRef.nodeId, props.data.ifRef.columnId)
    }
    return ''
  })

  // ============================================================================
  // 无条件触发开关
  // ============================================================================

  const toggleSkipIf = () => {
    const next = !props.data.skipIfCondition
    const patch: Partial<ConditionalConstraintNodeData> = {
      skipIfCondition: next,
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    }
    if (next) {
      // 开启无条件触发时，清空 IF 条件
      patch.ifConditions = []
      patch.ifRef = undefined
      patch.ifColumn = ''
      patch.ifValue = ''
    }
    updateData(patch)
  }

  // ============================================================================
  // THEN 条件配置（可视化编辑）
  // ============================================================================

  type ThenMode = 'value' | 'ref_column' | 'not_null'
  type ThenOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'

  const thenMode = ref<ThenMode>('value')
  const thenOperator = ref<ThenOperator>('eq')
  const thenValue = ref('')
  const thenRefColumn = ref('')

  // 从 data.thenConditionConfig 解析出 UI 状态
  const syncThenConfigFromData = () => {
    const cfg = props.data.thenConditionConfig
    if (!cfg || typeof cfg !== 'object') {
      thenMode.value = 'value'
      thenOperator.value = 'eq'
      thenValue.value = ''
      thenRefColumn.value = ''
      return
    }
    const config = cfg as Record<string, unknown>
    const op = config.operator as string | undefined

    if (op === 'not_null' || !op) {
      thenMode.value = 'not_null'
    } else if (config.ref_column) {
      thenMode.value = 'ref_column'
      thenOperator.value = (op as ThenOperator) || 'eq'
      thenRefColumn.value = String(config.ref_column)
    } else {
      thenMode.value = 'value'
      thenOperator.value = (op as ThenOperator) || 'eq'
      thenValue.value = config.value !== undefined ? String(config.value) : ''
    }
  }

  // 初始化同步
  syncThenConfigFromData()

  // 监听外部数据变化（如撤销/重做）
  watch(() => props.data.thenConditionConfig, syncThenConfigFromData, { deep: true })

  const handleThenModeChange = (event: Event) => {
    const mode = (event.target as HTMLSelectElement).value as ThenMode
    thenMode.value = mode
    if (mode === 'not_null') {
      updateData({
        thenConditionConfig: { operator: 'not_null' },
        validationStatus: 'idle',
        validationErrors: [],
        lastValidation: undefined,
      })
    } else if (mode === 'ref_column') {
      updateData({
        thenConditionConfig: { operator: thenOperator.value, ref_column: thenRefColumn.value },
        validationStatus: 'idle',
        validationErrors: [],
        lastValidation: undefined,
      })
    } else {
      updateData({
        thenConditionConfig: { operator: thenOperator.value, value: thenValue.value },
        validationStatus: 'idle',
        validationErrors: [],
        lastValidation: undefined,
      })
    }
  }

  const handleThenOperatorChange = (event: Event) => {
    thenOperator.value = (event.target as HTMLSelectElement).value as ThenOperator
    commitThenConfig()
  }

  const commitThenConfig = () => {
    let config: Record<string, unknown>
    if (thenMode.value === 'not_null') {
      config = { operator: 'not_null' }
    } else if (thenMode.value === 'ref_column') {
      config = { operator: thenOperator.value, ref_column: thenRefColumn.value }
    } else {
      // 尝试解析数值/布尔值
      const raw = thenValue.value.trim()
      let parsed: unknown = raw
      if (raw.toLowerCase() === 'true') parsed = true
      else if (raw.toLowerCase() === 'false') parsed = false
      else if (/^[-+]?\d+$/.test(raw) && !/^[-+]?0\d+/.test(raw)) {
        const n = Number.parseInt(raw, 10)
        if (Number.isFinite(n)) parsed = n
      } else if (/^[-+]?(?:\d+\.\d*|\.\d+)$/.test(raw)) {
        const n = Number.parseFloat(raw)
        if (Number.isFinite(n)) parsed = n
      }
      config = { operator: thenOperator.value, value: parsed }
    }
    updateData({
      thenConditionConfig: config,
      validationStatus: 'idle',
      validationErrors: [],
      lastValidation: undefined,
    })
  }

  // ============================================================================
  // 校验状态
  // ============================================================================

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
        return t('inspector.constraint.conditional.statusPass')
      case 'error':
        return t('inspector.constraint.conditional.statusError')
      case 'missing':
        return t('inspector.constraint.conditional.statusMissing')
      default:
        return t('inspector.constraint.conditional.statusIdle')
    }
  })
</script>

<style scoped>
  .conditional-constraint-inspector {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }

  .form-group-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .form-group label {
    font-size: 12px;
    color: var(--ui-text-muted);
  }

  .editable-input {
    width: 100%;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 6px 8px;
    color: var(--ui-text-primary);
    font-size: 12px;
    outline: none;
  }

  .editable-select {
    width: 100%;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 6px 8px;
    color: var(--ui-text-primary);
    font-size: 12px;
    outline: none;
  }

  .readonly-value {
    font-size: 12px;
    color: var(--ui-text-primary);
    padding: 4px 0;
  }

  .readonly-value.placeholder {
    color: var(--ui-text-muted);
    font-style: italic;
  }

  .field-hint {
    font-size: 11px;
    color: var(--ui-text-muted);
    margin-top: 2px;
  }

  .status-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .status-pass {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  .status-error {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .status-missing {
    background: rgba(245, 158, 11, 0.15);
    color: #f59e0b;
  }

  .status-idle {
    background: rgba(156, 163, 175, 0.15);
    color: #9ca3af;
  }

  .validation-stats {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }

  .stat-item {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }

  .stat-label {
    color: var(--ui-text-muted);
  }

  .stat-value {
    color: var(--ui-text-primary);
  }

  .stat-value.error {
    color: #ef4444;
  }

  .error-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
  }

  .error-item {
    font-size: 11px;
    color: #ef4444;
    padding: 4px 6px;
    background: rgba(239, 68, 68, 0.08);
    border-radius: 3px;
  }

  .error-more {
    font-size: 11px;
    color: var(--ui-text-muted);
  }
</style>

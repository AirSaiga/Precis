<template>
  <div class="composite-inspector">
    <div class="inspector-section">
      <label>{{ t('inspector.constraint.composite.configName') }}</label>
      <input v-model="localData.configName" type="text" @change="emitUpdate" />
    </div>

    <div class="inspector-section">
      <label>{{ t('inspector.constraint.composite.description') }}</label>
      <textarea v-model="localData.description" rows="2" @change="emitUpdate" />
    </div>

    <div class="inspector-section">
      <label>{{ t('inspector.constraint.composite.logic') }}</label>
      <select v-model="localData.logic" @change="emitUpdate">
        <option value="all">{{ t('inspector.constraint.composite.logicAll') }}</option>
        <option value="any">{{ t('inspector.constraint.composite.logicAny') }}</option>
        <option value="none">{{ t('inspector.constraint.composite.logicNone') }}</option>
      </select>
    </div>

    <div class="inspector-section">
      <label>{{ t('inspector.constraint.composite.enabled') }}</label>
      <input v-model="localData.enabled" type="checkbox" @change="emitUpdate" />
    </div>

    <!-- 聚合约束选择 -->
    <div class="inspector-section">
      <label>
        {{ t('inspector.constraint.composite.includedConstraints', { count: includedCount }) }}
      </label>
      <div class="constraint-picker">
        <div v-if="availableConstraints.length === 0" class="constraint-empty">
          {{ t('inspector.constraint.composite.noConstraintsAvailable') }}
        </div>
        <div
          v-for="item in availableConstraints"
          :key="item.node.id"
          class="constraint-option"
          :class="{ selected: item.selected }"
          @click="toggleConstraint(item.node.id)"
        >
          <input
            type="checkbox"
            :checked="item.selected"
            @click.stop
            @change="toggleConstraint(item.node.id)"
          />
          <span class="constraint-type-badge">{{ typeLabel(item.node.type) }}</span>
          <span class="constraint-name">{{ nodeName(item.node) }}</span>
        </div>
      </div>
    </div>

    <!-- 校验状态 -->
    <div v-if="props.data.validationStatus" class="inspector-section">
      <label>{{ t('inspector.constraint.composite.validationStatus') }}</label>
      <span class="status-badge" :class="statusClass">{{ statusText }}</span>
    </div>

    <div v-if="props.data.lastValidation" class="inspector-section">
      <label>{{ t('inspector.constraint.composite.totalRows') }}</label>
      <span class="readonly-value">{{ props.data.lastValidation.totalRows }}</span>
    </div>

    <div v-if="props.data.lastValidation" class="inspector-section">
      <label>{{ t('inspector.constraint.composite.errorCount') }}</label>
      <span class="readonly-value">{{ props.data.lastValidation.errorCount }}</span>
    </div>

    <div v-if="props.data.validationErrors?.length" class="inspector-section">
      <label>{{ t('inspector.constraint.composite.errorMessages') }}</label>
      <ul class="error-list">
        <li v-for="(err, i) in props.data.validationErrors" :key="i">{{ err }}</li>
      </ul>
    </div>

    <div class="inspector-section">
      <button class="action-btn action-validate" @click="handleValidate">
        {{ t('inspector.constraint.validateNow') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { reactive, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
  import type { CompositeConstraintNodeData } from '@/types/constraints'
  import type { Node } from '@vue-flow/core'

  const { t } = useI18n()
  const store = useGraphStore()

  interface Props {
    data: CompositeConstraintNodeData
    nodeId: string
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:data': [data: Partial<CompositeConstraintNodeData>]
  }>()

  const localData = reactive({
    configName: props.data.configName || '',
    description: props.data.description || '',
    logic: props.data.logic || 'all',
    enabled: props.data.enabled !== false,
  })

  const includedNodeIds = computed(() => props.data.includedNodeIds || [])
  const includedCount = computed(() => includedNodeIds.value.length)

  const statusClass = computed(() => {
    const s = props.data.validationStatus
    if (s === 'pass') return 'status-pass'
    if (s === 'error') return 'status-error'
    if (s === 'missing') return 'status-missing'
    return 'status-idle'
  })

  const statusText = computed(() => {
    const statusMap: Record<string, string> = {
      idle: t('inspector.constraint.composite.statusIdle'),
      pass: t('inspector.constraint.composite.statusPass'),
      error: t('inspector.constraint.composite.statusError'),
      missing: t('inspector.constraint.composite.statusMissing'),
    }
    return statusMap[props.data.validationStatus || 'idle'] || props.data.validationStatus
  })

  function handleValidate() {
    // Composite 通过 sourceRef 关联 Schema，触发整表校验
    const sourceNodeId = props.data.sourceRef?.nodeId
    if (sourceNodeId) {
      triggerValidationForNode(sourceNodeId, store.nodes, store.edges, store.updateNodeData)
    }
  }

  /**
   * 判断节点是否为约束类型（排除 composite 自身）
   */
  function isConstraintNodeType(type: string | undefined): boolean {
    if (!type) return false
    return type.endsWith('Constraint') && type !== 'compositeConstraint'
  }

  /**
   * 获取当前画布上所有可作为聚合目标的约束节点
   * 排除自身和 Composite 类型节点
   */
  const availableConstraints = computed(() => {
    return store.nodes
      .filter((n) => n.id !== props.nodeId && isConstraintNodeType(n.type))
      .map((n) => ({
        node: n,
        selected: includedNodeIds.value.includes(n.id),
      }))
  })

  function toggleConstraint(nodeId: string) {
    const current = new Set(includedNodeIds.value)
    if (current.has(nodeId)) {
      current.delete(nodeId)
    } else {
      current.add(nodeId)
    }
    emit('update:data', { includedNodeIds: Array.from(current) })
  }

  function emitUpdate() {
    emit('update:data', {
      configName: localData.configName,
      description: localData.description,
      logic: localData.logic,
      enabled: localData.enabled,
    })
  }

  function typeLabel(nodeType: string | undefined): string {
    if (!nodeType) return ''
    const map: Record<string, string> = {
      notNullConstraint: 'NotNull',
      uniqueConstraint: 'Unique',
      rangeConstraint: 'Range',
      allowedValuesConstraint: 'AllowedValues',
      foreignKeyConstraint: 'FK',
      conditionalConstraint: 'Conditional',
      scriptedConstraint: 'Scripted',
      charsetConstraint: 'Charset',
      dateLogicConstraint: 'DateLogic',
    }
    return map[nodeType] || nodeType.replace('Constraint', '')
  }

  function nodeName(node: Node): string {
    const data = (node.data || {}) as Record<string, unknown>
    return (data.configName as string) || (data.constraintName as string) || node.id
  }
</script>

<style scoped>
  .composite-inspector {
    padding: 12px;
  }

  .inspector-section {
    margin-bottom: 16px;
  }

  .inspector-section label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--ui-text-secondary);
    margin-bottom: 6px;
  }

  .inspector-section input[type='text'],
  .inspector-section textarea,
  .inspector-section select {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    background: var(--ui-bg-elevated);
    color: var(--ui-text-primary);
    font-size: 13px;
  }

  .inspector-section input[type='checkbox'] {
    width: auto;
    margin-top: 4px;
  }

  .constraint-picker {
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    background: var(--ui-bg-canvas);
  }

  .constraint-empty {
    padding: 12px;
    font-size: 12px;
    color: var(--ui-text-muted);
    text-align: center;
  }

  .constraint-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    border-bottom: 1px solid var(--ui-border-subtle);
    transition: background 0.15s ease;
  }

  .constraint-option:last-child {
    border-bottom: none;
  }

  .constraint-option:hover {
    background: var(--ui-accent-primary);
  }

  .constraint-option.selected {
    background: rgba(14, 99, 156, 0.2);
  }

  .constraint-type-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--ui-border-light);
    color: var(--ui-text-secondary);
    white-space: nowrap;
  }

  .constraint-name {
    font-size: 12px;
    color: var(--ui-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 3px;
    text-transform: uppercase;
  }

  .status-idle {
    background: var(--ui-border-light);
    color: var(--ui-text-muted);
  }

  .status-pass {
    background: rgba(34, 197, 94, 0.15);
    color: #16a34a;
  }

  .status-error {
    background: rgba(239, 68, 68, 0.15);
    color: #dc2626;
  }

  .status-missing {
    background: rgba(234, 179, 8, 0.15);
    color: #ca8a04;
  }

  .readonly-value {
    font-size: 13px;
    color: var(--ui-text-primary);
  }

  .error-list {
    margin: 0;
    padding-left: 16px;
    font-size: 12px;
    color: var(--ui-text-secondary);
  }

  .error-list li {
    margin-bottom: 4px;
  }

  .action-btn {
    width: 100%;
    padding: 7px 12px;
    border: 1px solid rgba(14, 99, 156, 0.3);
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .action-validate {
    background: rgba(14, 99, 156, 0.1);
    color: var(--ui-accent-primary, #0e639c);
  }

  .action-validate:hover {
    background: rgba(14, 99, 156, 0.2);
  }
</style>

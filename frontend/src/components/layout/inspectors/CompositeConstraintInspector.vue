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

    <div class="inspector-section">
      <label>{{ t('inspector.constraint.composite.saveState') }}</label>
      <span class="save-state">{{ localData.saveState || 'draft' }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { reactive, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
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
    saveState: props.data.saveState || 'draft',
  })

  const includedNodeIds = computed(() => props.data.includedNodeIds || [])
  const includedCount = computed(() => includedNodeIds.value.length)

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

  .save-state {
    font-size: 12px;
    color: var(--ui-text-muted);
    text-transform: uppercase;
  }
</style>

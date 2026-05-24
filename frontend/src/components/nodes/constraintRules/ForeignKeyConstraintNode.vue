<!--
  @file ForeignKeyConstraintNode.vue
  @description 外键约束节点组件

  在可视化画布中配置外键约束，建立表与表之间的关联关系，确保数据引用完整性。
-->
<template>
  <ConstraintNodeFrame
    class="foreign-key-constraint-node constraint-node"
    :class="['status-' + data.validationStatus, { 'is-selected': selected }]"
    theme="purple"
    :state="resolveNodeState(data.validationStatus, selected)"
    :title="t('customNodes.constraintRules.foreignKeyConstraintNode.title')"
    icon="🔗"
    :help-text="t('customNodes.constraintRules.foreignKeyConstraintNode.helpTooltip')"
    :error-count="errorCount"
    :show-save="true"
    :is-saving="isSaving"
    :delete-title="t('common.delete')"
    :error-title="t('common.error')"
    :save-title="t('common.save')"
    :save-text="t('common.save')"
    :saving-text="t('common.saving')"
    :handles="[
      {
        id: `target-input-${id}`,
        type: 'target',
        position: Position.Left,
        color: 'warning',
        title: t('customNodes.constraintRules.foreignKeyConstraintNode.inputHandle'),
      },
      {
        id: `source-output-${id}`,
        type: 'source',
        position: Position.Right,
        color: 'info',
        title: t('customNodes.constraintRules.foreignKeyConstraintNode.outputHandle'),
      },
    ]"
    @delete="handleDelete"
    @save="handleSave"
  >
    <ConstraintNodeLayout
      :status="validationStatus"
      :status-text="statusText"
      :error-count="errorCount"
      :show-details="showDetails"
    >
      <!-- 信息区：源和目标 -->
      <template #info>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.foreignKeyConstraintNode.sourceLabel')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasSource }">{{ sourceDisplay }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{
            t('customNodes.constraintRules.foreignKeyConstraintNode.targetLabel')
          }}</span>
          <span class="info-value" :class="{ placeholder: !hasTarget }">{{ targetDisplay }}</span>
        </div>
      </template>

      <!-- 详情区 -->
      <template #details>
        <div class="details-title">
          {{ t('customNodes.constraintRules.foreignKeyConstraintNode.detailsTitle') }}
        </div>

        <div v-if="data.lastValidation" class="details-metrics">
          <div v-for="metric in metrics" :key="metric.label" class="metric">
            {{ metric.label }}: {{ metric.value }}
          </div>
        </div>

        <div v-if="displayErrors.length > 0" class="details-errors">
          <div v-for="(msg, idx) in displayErrors" :key="idx" class="details-error">
            {{ msg }}
          </div>
        </div>
        <div v-else class="details-empty">
          {{ t('customNodes.constraintRules.foreignKeyConstraintNode.noDetails') }}
        </div>
      </template>
    </ConstraintNodeLayout>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { computed, ref, watch, nextTick } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import NodeBadge from '@/components/ui/NodeBadge.vue'
  import ConstraintNodeFrame from './shared/ConstraintNodeFrame.vue'
  import ConstraintNodeLayout from './shared/ConstraintNodeLayout.vue'
  import { resolveNodeState } from '@/components/ui/nodeVariants'
  import type { ForeignKeyConstraintNodeData, SchemaNodeData } from '@/types/graph'
  import type { Edge } from '@vue-flow/core'
  import { useForeignKey } from '@/composables/nodes/constraints/useForeignKey'
  import { useGraphStore } from '@/stores/graphStore'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { useConstraintNodeBase } from '@/composables/nodes/constraints/useConstraintNodeBase'

  const props = defineProps<{
    id: string
    data: ForeignKeyConstraintNodeData
    selected?: boolean
  }>()

  const emit = defineEmits<{
    (e: 'schemaConnected', data: any): void
    (e: 'schemaDisconnected', data: any): void
    (e: 'validationCompleted', data: any): void
    (e: 'validationErrors', data: any): void
    (e: 'configUpdated', data: any): void
  }>()

  const { t } = useI18n()
  const store = useGraphStore()
  const { showConfirm } = useGlobalConfirm()
  const { performValidation } = useForeignKey(props, emit)

  const {
    isSaving,
    validationStatus,
    validationErrors,
    displayErrors,
    errorCount,
    showDetails,
    statusText,
    metrics,
    handleSave,
    handleDelete,
  } = useConstraintNodeBase(props, {
    statusI18nPrefix: 'customNodes.constraintRules.foreignKeyConstraintNode',
  })

  // ===== 计算属性 =====

  const targetNodeId = computed(
    () => props.data.targetRef?.nodeId || props.data.config?.targetNodeId || ''
  )
  const hasSource = computed(() => !!props.data.sourceRef?.nodeId)
  const hasTarget = computed(() => !!targetNodeId.value)
  const hasTargetColumn = computed(() => !!props.data.targetRef?.columnId)

  const sourceDisplay = computed(() => {
    if (!hasSource.value)
      return t('customNodes.constraintRules.foreignKeyConstraintNode.waitingForSource')
    const table = props.data.sourceTable || ''
    const column = props.data.sourceColumn || ''
    if (!table && !column)
      return t('customNodes.constraintRules.foreignKeyConstraintNode.waitingForSource')
    return `${table}${table && column ? '.' : ''}${column}`
  })

  const targetNode = computed(() => {
    if (!targetNodeId.value) return null
    return store.nodes.find((n) => n.id === targetNodeId.value) || null
  })

  const targetDisplay = computed(() => {
    if (!hasTarget.value)
      return t('customNodes.constraintRules.foreignKeyConstraintNode.targetNotConnected')
    const table =
      props.data.targetTable ||
      (targetNode.value?.type === 'schema'
        ? (targetNode.value.data as unknown as SchemaNodeData).tableName || ''
        : '')
    const column = props.data.targetColumn || props.data.config?.targetColumn || ''
    if (!column)
      return `${table}${table ? '.' : ''}${t('customNodes.constraintRules.foreignKeyConstraintNode.targetColumnPlaceholder')}`
    return `${table}${table ? '.' : ''}${column}`
  })

  // ===== 展示边管理 =====
  // 规则：只要定义了目标表和目标列，自动创建虚线展示边，无需手动开关

  const localTargetNodeId = ref<string>(targetNodeId.value || '')
  const localTargetColumnId = ref<string>(props.data.targetRef?.columnId || '')

  const getDisplayTargetEdges = () => {
    const outputHandleId = `source-output-${props.id}`
    return store.edges.filter(
      (e: any) =>
        e.source === props.id &&
        e.sourceHandle === outputHandleId &&
        e.targetHandle?.startsWith('source-right-')
    )
  }

  const removeDisplayTargetEdges = () => {
    getDisplayTargetEdges().forEach((e: any) => store.deleteConnection(e.id))
  }

  const ensureDisplayTargetEdge = () => {
    // 自动创建条件：有目标表节点ID 且 有目标列ID
    const targetColId = props.data.targetRef?.columnId || ''
    const hasValidTarget = !!targetNodeId.value && !!targetColId
    if (!hasValidTarget) {
      removeDisplayTargetEdges()
      return
    }

    const outputHandleId = `source-output-${props.id}`
    const targetHandleId = `source-right-${targetColId}`
    const edges = getDisplayTargetEdges()
    // 清理指向其他列的旧边
    edges
      .filter((e: any) => e.target !== targetNodeId.value || e.targetHandle !== targetHandleId)
      .forEach((e: any) => store.deleteConnection(e.id))

    const alreadyExists = store.edges.some(
      (e: any) =>
        e.source === props.id &&
        e.target === targetNodeId.value &&
        e.sourceHandle === outputHandleId &&
        e.targetHandle === targetHandleId
    )
    if (alreadyExists) return

    store.createConnection(props.id, targetNodeId.value, outputHandleId, targetHandleId, {
      type: 'smoothstep',
      animated: false,
      class: 'fk-display-edge',
      style: { stroke: 'var(--theme-purple)', strokeWidth: 1.4, strokeDasharray: '2 8' },
      data: { kind: 'fkDisplay', fkNodeId: props.id },
    } as Partial<Edge>)
  }

  // ===== Watchers =====

  watch(
    () => props.data.targetRef?.columnId,
    (next) => {
      localTargetColumnId.value = next || ''
      if (next && hasSource.value) {
        performValidation().catch(() => undefined)
      }
      // 目标列变化时自动更新展示边
      ensureDisplayTargetEdge()
    }
  )

  watch(
    () => props.data.targetRef?.nodeId,
    () => {
      localTargetNodeId.value = targetNodeId.value || ''
      localTargetColumnId.value = props.data.targetRef?.columnId || ''
      // 目标表变化时自动更新展示边
      ensureDisplayTargetEdge()
    }
  )

  watch(
    () => targetNodeId.value,
    (next) => {
      localTargetNodeId.value = next || ''
      if (!next) {
        localTargetColumnId.value = ''
      }
      // 自动创建展示边（无需手动开关）
      ensureDisplayTargetEdge()
    }
  )

  // 初始化时自动创建展示边
  nextTick(() => {
    ensureDisplayTargetEdge()
  })
</script>

<style scoped src="./ForeignKeyConstraintNode.styles.css"></style>

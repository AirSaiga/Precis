<!--
  @file ActionButtonRenderer.vue
  @description 操作按钮渲染器，用于在 Inspector 中触发校验等操作
-->
<template>
  <div class="field action-button-field">
    <button class="action-btn" :class="[`action-${field.action}`]" @click="handleAction">
      {{ buttonLabel }}
    </button>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { triggerValidationForNode } from '@/services/constraints/orchestration/globalValidation'
  import type { InspectorContext } from '../utils'
  import { getByPath } from '../utils'
  import type { InspectorActionButtonField } from '../types'

  const { t } = useI18n()
  const store = useGraphStore()

  const props = defineProps<{
    field: InspectorActionButtonField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const buttonLabel = computed(() => t(props.field.buttonLabelKey))

  function handleAction() {
    if (props.field.action === 'validate') {
      handleValidate()
    }
  }

  function handleValidate() {
    // 从节点数据中获取 sourceRef.nodeId（关联的 Schema 节点 ID）
    const sourceNodeId = getByPath(props.ctx.data, ['sourceRef', 'nodeId']) as string | undefined

    if (sourceNodeId) {
      triggerValidationForNode(sourceNodeId, store.nodes, store.edges, store.updateNodeData)
    }
  }
</script>

<style scoped>
  .action-button-field {
    padding-top: 4px;
  }

  .action-btn {
    width: 100%;
    padding: 7px 12px;
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .action-validate {
    background: rgba(14, 99, 156, 0.1);
    color: var(--ui-accent-primary, #0e639c);
    border-color: rgba(14, 99, 156, 0.3);
  }

  .action-validate:hover {
    background: rgba(14, 99, 156, 0.2);
  }
</style>

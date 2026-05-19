<!--
  @file TransformNode.vue
  @description 功能/转换节点组件 - 数据转换与处理

  核心功能：
  - 字符串切割、正则提取、数学表达式、日期格式化
  - 数据流输入输出
  - 参数配置与保存

  数据流：
  SourcePreview/Schema/Transform/Regex → [transform-input Handle] → TransformNode → [transform-output Handle] → Transform/Regex/Constraint

  重构说明：
  - 业务计算逻辑 → composables/nodes/transform/transformCalculations.ts
  - 保存编排逻辑 → composables/nodes/transform/useTransformSave.ts
  - 输出节点管理 → composables/nodes/transform/useTransformOutputManager.ts
  - 显示辅助函数 → composables/nodes/transform/transformDisplay.ts
  - 类型常量集合 → composables/nodes/transform/transformTypeRegistry.ts
-->
<template>
  <ConstraintNodeFrame
    class="transform-node"
    :selected="selected"
    theme="sky"
    state="idle"
    :title="data.configName || t('customNodes.transformNode.title')"
    icon="⚙️"
    :help-text="t('customNodes.transformNode.helpTooltip')"
    :show-save="true"
    :is-saving="isSaving"
    :delete-title="t('customNodes.transformNode.closeTooltip')"
    :save-title="t('common.save')"
    :save-text="t('common.save')"
    :saving-text="t('common.saving')"
    :shell-title="data.configName || t('customNodes.transformNode.title')"
    :handles="[
      {
        id: 'transform-input',
        type: 'target',
        position: Position.Left,
        color: 'primary',
        title: t('customNodes.transformNode.inputHandle'),
      },
      {
        id: 'transform-output',
        type: 'source',
        position: Position.Right,
        color: 'success',
        title: t('customNodes.transformNode.outputHandle'),
      },
    ]"
    @click="onNodeClick"
    @delete="handleClose"
    @save="handleSave"
  >
    <div class="content">
      <div class="summary-row">
        <span class="summary-label">{{ t('customNodes.transformNode.typeLabel') }}</span>
        <span class="summary-value">{{ typeDisplay }}</span>
      </div>

      <div class="summary-row">
        <span class="summary-label">{{ t('customNodes.transformNode.inputColumnLabel') }}</span>
        <span class="summary-value" :class="{ placeholder: !data.inputColumn }">
          {{ data.inputColumn || t('customNodes.transformNode.notSet') }}
        </span>
      </div>

      <div class="summary-row">
        <span class="summary-label">{{ t('customNodes.transformNode.outputColumnsLabel') }}</span>
        <span class="summary-value" :class="{ placeholder: !hasOutputColumns }">
          {{ outputColumnsDisplay }}
        </span>
      </div>

      <div class="params-section">
        <div class="params-header">
          <span class="summary-label">{{ t('customNodes.transformNode.paramsLabel') }}</span>
        </div>
        <code class="mono-block" :class="{ placeholder: !hasParams }">
          {{ paramsDisplay }}
        </code>
      </div>
    </div>
  </ConstraintNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { Position, useNode } from '@vue-flow/core'
  import { useI18n } from 'vue-i18n'
  import ConstraintNodeFrame from '@/components/nodes/constraintRules/shared/ConstraintNodeFrame.vue'
  import type { TransformNodeData } from '@/types/nodes'
  import { useGraphStore } from '@/stores/graphStore'
  import { useTransformSave, TRANSFORM_TYPE_I18N_KEYS, getParamsDisplay } from '@/composables/nodes/transform'

  const { t } = useI18n()
  const { id, node } = useNode()
  const rawData = computed(() => node.data)
  const selected = computed(() => node.selected)
  const graphStore = useGraphStore()
  const { handleSave: doSave } = useTransformSave()

  const data = computed(() => rawData.value as TransformNodeData)
  const isSaving = computed(() => false)

  // ---- 显示层 computed ----

  const typeDisplay = computed(() => {
    const i18nKey = TRANSFORM_TYPE_I18N_KEYS[data.value.transformType]
    return i18nKey ? t(i18nKey) : data.value.transformType
  })

  const hasOutputColumns = computed(
    () => Array.isArray(data.value.outputColumns) && data.value.outputColumns.length > 0
  )

  const outputColumnsDisplay = computed(() => {
    if (!hasOutputColumns.value) return t('customNodes.transformNode.notSet')
    return data.value.outputColumns.join(', ')
  })

  const hasParams = computed(() => {
    if (data.value.transformType === 'StringSplit') return true
    return data.value.params && Object.keys(data.value.params).length > 0
  })

  const paramsDisplay = computed(() => {
    const text = getParamsDisplay(data.value.transformType, data.value.params)
    return text || t('customNodes.transformNode.paramsEmpty')
  })

  // ---- 事件处理 ----

  function onNodeClick() {
    graphStore.selectedNodeId = id
  }

  function handleClose() {
    graphStore.deleteNode(id)
  }

  function handleSave() {
    doSave(id)
  }
</script>

<style scoped>
  .transform-node {
    width: 280px;
  }

  .content {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .summary-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .summary-label {
    color: var(--ui-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .summary-value {
    color: var(--ui-text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-value.placeholder {
    color: var(--ui-text-muted);
    font-style: italic;
    font-weight: normal;
  }

  .params-section {
    margin-top: 4px;
  }

  .params-header {
    margin-bottom: 4px;
  }

  .mono-block {
    display: block;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    border-radius: 4px;
    padding: 6px 8px;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
    color: var(--ui-text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 80px;
    overflow-y: auto;
  }

  .mono-block.placeholder {
    color: var(--ui-text-muted);
    font-style: italic;
  }
</style>

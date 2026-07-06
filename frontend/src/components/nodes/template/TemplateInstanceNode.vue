<!--
  @file TemplateInstanceNode.vue
  @description 模板实例节点组件 — 支持紧凑卡片 / 容器框架双模式渲染

  折叠态：自定义卡片布局，展示图标、名称、参数摘要和状态标签。
  展开态：渲染为带标题栏的容器框，DAG 子节点通过 Vue Flow parentNode 机制嵌套在内部。
-->
<template>
  <!-- ============ 折叠态：紧凑卡片 ============ -->
  <NodeShell
    v-if="!isExpanded"
    class="template-instance-node"
    :selected="selected"
    theme="purple"
    state="idle"
    :show-delete="true"
    :show-save="true"
    :is-saving="isSaving"
    delete-title="Delete"
    save-title="Save"
    save-text="Save"
    saving-text="Saving..."
    @click="onNodeClick"
    @delete="handleClose"
    @save="handleSave"
  >
    <template #header>
      <NodeHeader
        :title="data.templateName || configName"
        icon-name="puzzle"
        theme="purple"
        status="idle"
      />
      <NodeDivider theme="purple" spacing="sm" />
    </template>

    <div class="template-content">
      <div v-if="data.templateName" class="template-row">
        <span class="template-label">TEMPLATE</span>
        <span class="template-value">{{ data.templateName }}</span>
      </div>
      <div v-if="summaryText" class="template-row">
        <span class="template-label">PARAMS</span>
        <span class="template-value template-value--truncate">{{ summaryText }}</span>
      </div>
      <div v-else class="template-empty">
        {{ t('inspector.templateInstance.noParams') }}
      </div>
      <div class="template-footer">
        <span class="template-count"
          >{{ nodeCount }} {{ t('inspector.templateInstance.nodeCount') }}</span
        >
        <span
          class="template-badge"
          :class="saveState === 'saved' ? 'template-badge--saved' : 'template-badge--draft'"
        >
          {{
            saveState === 'saved'
              ? t('inspector.templateInstance.saved')
              : t('inspector.templateInstance.unsaved')
          }}
        </span>
      </div>
    </div>
  </NodeShell>

  <!-- ============ 展开态：容器框架 ============ -->
  <div v-else class="template-container" :class="{ 'is-selected': selected }" @click="onNodeClick">
    <div class="template-container__header">
      <span class="template-container__icon">🧩</span>
      <span class="template-container__title">{{ data.templateName || configName }}</span>

      <span v-if="summaryText" class="template-container__summary">
        {{ summaryText }}
      </span>

      <div class="template-container__actions nodrag">
        <button
          class="template-container__btn"
          type="button"
          title="保存"
          @mousedown.stop
          @click.stop="handleSave"
        >
          {{ isSaving ? '…' : '✓' }}
        </button>
        <button
          class="template-container__btn template-container__btn--collapse"
          type="button"
          title="折叠"
          @mousedown.stop
          @click.stop="handleToggle"
        >
          ▲
        </button>
        <button
          class="template-container__btn template-container__btn--delete"
          type="button"
          title="删除"
          @mousedown.stop
          @click.stop="handleClose"
        >
          ×
        </button>
      </div>
    </div>

    <div class="template-container__body nodrag nowheel" />
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useNode } from '@vue-flow/core'
  import { useI18n } from 'vue-i18n'
  import NodeShell from '@/components/ui/NodeShell.vue'
  import NodeHeader from '@/components/ui/NodeHeader.vue'
  import NodeDivider from '@/components/ui/NodeDivider.vue'
  import type { TemplateInstanceNodeData } from '@/types/nodes'
  import { useGraphStore } from '@/stores/graphStore'

  const { t } = useI18n()
  const { id, node } = useNode()
  const rawData = computed(() => node.data)
  const selected = computed(() => node.selected)
  const graphStore = useGraphStore()

  const data = computed(() => rawData.value as TemplateInstanceNodeData)
  const configName = computed(() => data.value.configName || '')
  const summaryText = computed(() => data.value.summaryText || '')
  const nodeCount = computed(() => data.value.nodeCount || 0)
  const saveState = computed(() => data.value.saveState || 'draft')
  const isExpanded = computed(() => data.value.expanded === true)
  const isSaving = ref(false)

  function onNodeClick() {
    graphStore.selectedNodeId = id
  }

  function handleClose() {
    graphStore.deleteNode(id)
  }

  async function handleSave() {
    isSaving.value = true
    try {
      await graphStore.saveTemplateInstanceNode(id)
    } finally {
      isSaving.value = false
    }
  }

  function handleToggle() {
    if (isExpanded.value) {
      graphStore.collapseExpansion(id)
    } else {
      graphStore.reExpand(id)
    }
  }
</script>

<style scoped>
  /* ============ 折叠态 ============ */
  .template-instance-node {
    --constraint-node-width: var(--node-width-default, 280px);
  }

  .template-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px 10px;
  }

  .template-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 20px;
  }

  .template-label {
    font-size: var(--node-muted-size);
    font-weight: 600;
    color: var(--ui-text-muted, #858585);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
    width: 52px;
  }

  .template-value {
    font-size: var(--node-text-size);
    font-weight: 500;
    color: var(--ui-text-primary, #cccccc);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .template-value--truncate {
    color: var(--ui-text-secondary, #9cdcfe);
  }

  .template-empty {
    font-size: var(--node-muted-size);
    color: var(--ui-text-muted, #858585);
    font-style: italic;
    padding: 2px 0;
  }

  .template-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 6px;
    border-top: 1px solid var(--ui-border-subtle, #333333);
  }

  .template-count {
    font-size: var(--node-muted-size);
    color: var(--ui-text-muted, #858585);
    font-weight: 500;
  }

  .template-badge {
    font-size: var(--node-muted-size);
    font-weight: 600;
    padding: 2px 8px;
    border-radius: var(--node-radius-sm);
    line-height: 1.3;
  }

  .template-badge--draft {
    color: var(--theme-orange, #d19a66);
    background: color-mix(in srgb, var(--theme-orange, #d19a66) 14%, transparent);
  }

  .template-badge--saved {
    color: var(--ui-success, #73c991);
    background: color-mix(in srgb, var(--ui-success, #73c991) 14%, transparent);
  }

  /* ============ 展开态：容器框架 ============ */
  .template-container {
    width: 100%;
    height: 100%;
    border: 1px dashed color-mix(in srgb, var(--theme-purple, #805ad5) 50%, var(--ui-border-subtle));
    border-radius: var(--node-radius-lg, 10px);
    background: color-mix(in srgb, var(--ui-bg-canvas, #1e1e1e) 60%, transparent);
    display: flex;
    flex-direction: column;
    overflow: visible;
    position: relative;
    transition:
      border-color var(--node-transition-fast, 0.15s),
      box-shadow var(--node-transition-fast, 0.15s);
  }

  .template-container:hover {
    border-color: color-mix(in srgb, var(--theme-purple, #805ad5) 60%, var(--ui-border-light));
    box-shadow: var(--node-shadow-hover);
  }

  .template-container.is-selected {
    border-color: var(--theme-purple, #805ad5);
    border-style: solid;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-purple, #805ad5) 15%, transparent);
  }

  .template-container__handle {
    position: absolute;
    left: -6px;
    top: 50%;
    transform: translateY(-50%);
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--theme-purple, #805ad5);
    border: 2px solid var(--node-bg, var(--ui-bg-elevated));
    z-index: 10;
    transition: transform var(--node-transition-fast, 0.15s);
  }

  .template-container:hover .template-container__handle {
    transform: translateY(-50%) scale(1.15);
  }

  .template-container__header {
    display: flex;
    align-items: center;
    gap: var(--constraint-gap-sm, 8px);
    padding: 0 var(--node-padding-md, 12px);
    height: var(--node-header-height, 36px);
    min-height: var(--node-header-height, 36px);
    background: color-mix(in srgb, var(--ui-bg-elevated) 85%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px dashed color-mix(in srgb, var(--theme-purple, #805ad5) 30%, transparent);
    border-radius: var(--node-radius-lg, 10px) var(--node-radius-lg, 10px) 0 0;
    cursor: grab;
    user-select: none;
  }

  .template-container__icon {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--node-radius-sm);
    background: color-mix(in srgb, var(--theme-purple, #805ad5) 12%, var(--ui-bg-elevated));
    border: 1px solid color-mix(in srgb, var(--theme-purple, #805ad5) 22%, transparent);
    font-size: var(--node-text-size);
    flex-shrink: 0;
    box-shadow: var(--node-shadow-sm);
  }

  .template-container__title {
    font-size: var(--node-title-size, 12px);
    font-weight: var(--node-title-weight, 600);
    color: var(--node-title-color, var(--ui-text-primary));
    line-height: var(--node-title-line-height, 1.3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .template-container__summary {
    font-size: var(--node-muted-size, 10px);
    color: var(--node-muted-color, var(--ui-text-muted));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .template-container__actions {
    display: flex;
    gap: 2px;
    margin-left: auto;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--node-transition-fast, 0.15s);
  }

  .template-container:hover .template-container__actions {
    opacity: 1;
  }

  .template-container__btn {
    width: var(--node-btn-size-xs, 20px);
    height: var(--node-btn-size-xs, 20px);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--node-btn-radius-xs, 4px);
    background: transparent;
    color: var(--ui-text-muted, #858585);
    cursor: pointer;
    font-size: var(--node-text-size);
    line-height: 1;
    padding: 0;
    transition:
      background var(--node-transition-fast, 0.12s),
      color var(--node-transition-fast, 0.12s),
      border-color var(--node-transition-fast, 0.12s);
  }

  .template-container__btn:hover {
    background: var(--ui-bg-hover);
    color: var(--ui-text-primary, #cccccc);
    border-color: var(--ui-border-light);
  }

  .template-container__btn--delete:hover {
    background: color-mix(in srgb, var(--ui-danger, #f44747) 15%, transparent);
    color: var(--ui-danger, #f44747);
    border-color: color-mix(in srgb, var(--ui-danger, #f44747) 30%, transparent);
  }

  .template-container__btn--collapse:hover {
    background: color-mix(in srgb, var(--theme-purple, #805ad5) 15%, transparent);
    color: var(--theme-purple, #805ad5);
    border-color: color-mix(in srgb, var(--theme-purple, #805ad5) 30%, transparent);
  }

  .template-container__body {
    flex: 1;
    position: relative;
    pointer-events: none;
    background: color-mix(in srgb, var(--ui-bg-canvas, #1e1e1e) 30%, transparent);
  }
</style>

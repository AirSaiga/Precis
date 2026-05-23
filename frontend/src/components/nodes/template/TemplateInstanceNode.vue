<!--
  @file TemplateInstanceNode.vue
  @description 模板实例节点组件 — 支持紧凑卡片 / 容器框架双模式渲染

  折叠态：显示为 ConstraintNodeFrame 包裹的紧凑卡片，展示参数摘要和节点计数。
  展开态：渲染为带标题栏的容器框，DAG 子节点通过 Vue Flow parentNode 机制嵌套在内部。
-->
<template>
  <!-- ============ 折叠态：紧凑卡片 ============ -->
  <ConstraintNodeFrame
    v-if="!isExpanded"
    class="template-instance-node"
    :selected="selected"
    theme="purple"
    state="idle"
    :title="data.templateName || configName"
    icon="🧩"
    :show-save="true"
    :is-saving="isSaving"
    :handles="[
      { id: 'template-input', type: 'target', position: Position.Left, color: 'primary' },
    ]"
    @click="onNodeClick"
    @delete="handleClose"
    @save="handleSave"
  >
    <template #content>
      <div class="template-content">
        <div v-if="summaryText" class="template-summary">
          {{ summaryText }}
        </div>
        <div v-else class="template-summary template-summary--empty">
          {{ t('inspector.templateInstance.noParams') }}
        </div>

        <div class="template-meta">
          <span class="template-meta__item">{{ nodeCount }} {{ t('inspector.templateInstance.nodeCount') }}</span>
          <span
            class="template-meta__status"
            :class="{
              'template-meta__status--draft': saveState === 'draft',
              'template-meta__status--saved': saveState === 'saved',
            }"
          >
            {{ saveState === 'draft' ? t('inspector.templateInstance.unsaved') : t('inspector.templateInstance.saved') }}
          </span>
        </div>
      </div>
    </template>
  </ConstraintNodeFrame>

  <!-- ============ 展开态：容器框架 ============ -->
  <div
    v-else
    class="template-container"
    :class="{ 'is-selected': selected }"
    @click="onNodeClick"
  >
    <!-- 连接 handle -->
    <Handle
      id="template-input"
      type="target"
      :position="Position.Left"
      class="template-container__handle"
    />

    <!-- 标题栏 -->
    <div class="template-container__header nodrag">
      <span class="template-container__icon">🧩</span>
      <span class="template-container__title">{{ data.templateName || configName }}</span>

      <span v-if="summaryText" class="template-container__summary">
        {{ summaryText }}
      </span>

      <div class="template-container__actions">
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

    <!-- 子节点渲染区域（由 Vue Flow parentNode 机制自动填充） -->
    <div class="template-container__body nodrag nowheel" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import ConstraintNodeFrame from '@/components/nodes/constraintRules/shared/ConstraintNodeFrame.vue'
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
    // 尝试恢复已有子节点；若无子节点则由 Inspector 触发首次展开
    graphStore.reExpand(id)
  }
}
</script>

<style scoped>
/* ============ 折叠态（沿用现有样式） ============ */
.template-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
  font-size: 11px;
  color: var(--ui-text-secondary, #9cdcfe);
}

.template-summary {
  line-height: 1.4;
  word-break: break-all;
}

.template-summary--empty {
  color: var(--ui-text-muted, #858585);
  font-style: italic;
}

.template-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--ui-text-muted, #858585);
}

.template-meta__status--draft {
  color: #d19a66;
}

.template-meta__status--saved {
  color: #73c991;
}

/* ============ 展开态：容器框架 ============ */
.template-container {
  width: 100%;
  height: 100%;
  border: 2px solid rgba(128, 90, 213, 0.5);
  border-radius: 8px;
  background: rgba(128, 90, 213, 0.04);
  display: flex;
  flex-direction: column;
  overflow: visible;
  position: relative;
  transition: border-color 0.15s ease;
}

.template-container.is-selected {
  border-color: rgba(128, 90, 213, 0.9);
  box-shadow: 0 0 0 1px rgba(128, 90, 213, 0.4);
}

.template-container__handle {
  position: absolute;
  left: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #805ad5;
  border: 2px solid #1e1e1e;
  z-index: 10;
}

.template-container__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 36px;
  min-height: 36px;
  background: rgba(128, 90, 213, 0.12);
  border-bottom: 1px solid rgba(128, 90, 213, 0.25);
  border-radius: 6px 6px 0 0;
  cursor: grab;
  user-select: none;
}

.template-container__icon {
  font-size: 14px;
  flex-shrink: 0;
}

.template-container__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-text-primary, #cccccc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.template-container__summary {
  font-size: 10px;
  color: var(--ui-text-muted, #858585);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.template-container__actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

.template-container__btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--ui-text-muted, #858585);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0;
  transition: background 0.12s ease, color 0.12s ease;
}

.template-container__btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--ui-text-primary, #cccccc);
}

.template-container__btn--delete:hover {
  background: rgba(244, 71, 71, 0.2);
  color: #f44747;
}

.template-container__btn--collapse:hover {
  background: rgba(128, 90, 213, 0.2);
  color: #b794f4;
}

.template-container__body {
  flex: 1;
  position: relative;
  pointer-events: none;
}
</style>

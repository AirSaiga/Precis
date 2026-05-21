<template>
  <ConstraintNodeFrame
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
      { id: 'template-output', type: 'source', position: Position.Right, color: 'success' },
    ]"
    @click="onNodeClick"
    @delete="handleClose"
    @save="handleSave"
  >
    <template #content>
      <div class="template-content">
        <!-- 参数摘要 -->
        <div v-if="summaryText" class="template-summary">
          {{ summaryText }}
        </div>
        <div v-else class="template-summary template-summary--empty">
          {{ t('inspector.templateInstance.noParams') }}
        </div>

        <!-- 状态指示 -->
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
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Position, useNode } from '@vue-flow/core'
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
</script>

<style scoped>
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
</style>

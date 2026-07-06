<!--
  @file ManualDataNode.vue
  @description 手动数据节点组件 - 单列测试数据输入

  设计约束：仅支持单列数据，用于快速测试约束节点。
  如需多列，请创建多个 manualData 节点。
  - 左侧输入 Handle：接收来自 Schema 列的连接
  - 右侧列级 Handle（source-right-0）：传递单列数据到下游
  - 底部整体输出 Handle（source-bottom）：传递整张表到 Transform/Schema
-->
<template>
  <div
    class="manual-data-node graph-node"
    :class="{ 'is-selected': selected }"
    :style="{ width: nodeWidth + 'px' }"
  >
    <!-- 左侧输入 Handle：接收来自 Schema 列的连接 -->
    <NodeHandle
      id="target-left"
      type="target"
      :position="Position.Left"
      color="primary"
      size="md"
      sideOffset="2px"
      :title="t('customNodes.manualDataNode.inputHandle')"
      class="input-handle"
    />

    <!-- 头部：标题和图标 -->
    <div
      class="manual-data-header"
      @mouseenter="headerHovered = true"
      @mouseleave="headerHovered = false"
    >
      <div class="header-icon">
        <AppIcon name="edit" :size="18" />
      </div>
      <div class="header-content">
        <div class="node-name">{{ data.configName }}</div>
        <div class="node-meta">
          {{ data.rows.length }} {{ t('customNodes.manualDataNode.rows') }}
        </div>
      </div>

      <button
        v-show="headerHovered"
        class="remove-btn"
        :title="t('customNodes.manualDataNode.removeTooltip')"
        @click="handleRemove"
      >
        ×
      </button>
    </div>

    <!-- 数据列表预览：单列 -->
    <div class="data-table-container">
      <div class="data-table">
        <div class="data-header-row">
          <div class="data-column-header" :title="data.columnName">
            {{ data.columnName }}
          </div>
          <!-- 单列 Handle：放在 header 右侧 -->
          <NodeHandle
            id="source-right-0"
            type="source"
            :position="Position.Right"
            color="primary"
            size="md"
            sideOffset="2px"
            :title="t('customNodes.manualDataNode.columnHandle', { name: data.columnName })"
            class="column-handle"
          />
        </div>
        <div class="data-body">
          <div
            v-for="(row, rIdx) in displayRows"
            :key="rIdx"
            class="data-row"
            :class="{ 'is-zebra': rIdx % 2 === 1 }"
          >
            <div class="row-number">{{ rIdx + 1 }}</div>
            <div class="data-value" :title="row[0] || ''">
              {{ row[0] || '' }}
            </div>
          </div>
        </div>
      </div>
      <div v-if="data.rows.length > maxDisplayRows" class="data-footer">
        +{{ data.rows.length - maxDisplayRows }} {{ t('customNodes.manualDataNode.moreRows') }}
      </div>
    </div>

    <!-- 底部整体输出 Handle：用于连接 Transform / Schema -->
    <NodeHandle
      id="source-bottom"
      type="source"
      :position="Position.Bottom"
      color="success"
      size="sm"
      :title="t('customNodes.manualDataNode.tableHandle')"
      class="table-output-handle"
    />
  </div>
</template>

<script setup lang="ts">
  import { Position } from '@vue-flow/core'
  import { ref, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { ManualDataNodeData } from '@/types/nodes'
  import NodeHandle from '@/components/ui/NodeHandle.vue'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import { NodeDeletionManager } from '@/services/managers/nodeDeletionManager'

  const { t } = useI18n()

  const props = defineProps<{
    id: string
    data: ManualDataNodeData
    selected?: boolean
  }>()

  const nodeId = computed(() => props.id)
  const nodeWidth = ref(200)
  const headerHovered = ref(false)
  const maxDisplayRows = 5

  const displayRows = computed(() => {
    return props.data.rows.slice(0, maxDisplayRows)
  })

  function handleRemove() {
    const manager = NodeDeletionManager.getInstance()
    manager.delete(nodeId.value)
  }
</script>

<style scoped src="./ManualDataNode.css"></style>

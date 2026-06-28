<!--
  @file TransformOutputNode.vue
  @description Transform 输出节点组件 - 绑定在 transform 上的结果展示

  核心特点：
  - 由 transform 节点自动生成，不可独立创建
  - 删除父 transform 时自动级联删除
  - 外观类似 manualData，但使用 sky 主题色调
  - 无删除按钮
-->
<template>
  <div
    class="transform-output-node manual-data-node graph-node"
    :class="{ 'is-selected': selected }"
    :style="{ width: nodeWidth + 'px' }"
  >
    <!-- 左侧输入 Handle（与父 Transform 连线） -->
    <NodeHandle
      id="target-left"
      type="target"
      :position="Position.Left"
      color="sky"
      size="md"
      sideOffset="2px"
      title="Transform output"
      class="input-handle"
    />

    <!-- 头部 -->
    <div class="manual-data-header">
      <div class="header-icon">
        <span>📤</span>
      </div>
      <div class="header-content">
        <div class="node-name">{{ data.columnName }}</div>
        <div class="node-meta">{{ data.rows.length }} rows</div>
      </div>
    </div>

    <!-- 数据表格预览 -->
    <div class="data-table-container">
      <div class="data-table single-column">
        <div class="data-header-row">
          <div class="data-header-cell data-column-header" :title="data.columnName">
            {{ data.columnName }}
            <NodeHandle
              id="source-right-0"
              type="source"
              :position="Position.Right"
              color="sky"
              size="md"
              sideOffset="2px"
              :title="`Connect column: ${data.columnName}`"
              class="column-handle"
            />
          </div>
        </div>
        <div class="data-body">
          <div v-for="(row, rIdx) in displayRows" :key="rIdx" class="data-row">
            <div class="data-cell data-value" :title="row[0] || ''">
              {{ row[0] || '' }}
            </div>
          </div>
        </div>
      </div>
      <div v-if="data.rows.length > maxDisplayRows" class="data-footer">
        +{{ data.rows.length - maxDisplayRows }} more rows
      </div>
    </div>

    <!-- 底部整体输出 Handle -->
    <NodeHandle
      id="source-bottom"
      type="source"
      :position="Position.Bottom"
      color="success"
      size="sm"
      title="Transform output"
      class="table-output-handle"
    />
  </div>
</template>

<script setup lang="ts">
  import { Position } from '@vue-flow/core'
  import { ref, computed } from 'vue'
  import type { TransformOutputNodeData } from '@/types/nodes'
  import NodeHandle from '@/components/ui/NodeHandle.vue'

  const props = defineProps<{
    id: string
    data: TransformOutputNodeData
    selected?: boolean
  }>()

  const nodeWidth = ref(180)
  const maxDisplayRows = 5

  const displayRows = computed(() => {
    return props.data.rows.slice(0, maxDisplayRows)
  })
</script>

<style scoped src="@/components/nodes/manualData/ManualDataNode.css"></style>

<style scoped>
  .transform-output-node {
    border-color: rgba(14, 165, 233, 0.35);
    background: rgba(14, 165, 233, 0.06);
  }

  .transform-output-node .manual-data-header {
    background: rgba(14, 165, 233, 0.12);
    border-bottom-color: rgba(14, 165, 233, 0.25);
  }

  .transform-output-node.is-selected {
    border-color: var(--ui-accent);
    /* box-shadow 已上交 node-shell-contract.css 统一管理 */
  }
</style>

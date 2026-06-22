/** * @file TableSetRootNode.vue * @description 表集合根节点组件 * * 核心功能： * -
作为表集合的顶层容器 * - 显示所有数据表节点的入口 * - 提供创建新数据表节点的入口 * * 节点结构： * -
Header：根节点图标、标题 * - Content：表集合内容区域 */
<template>
  <GraphNodeFrame
    class="table-set-root-node graph-node"
    theme="info"
    icon="📂"
    :title="data.setName"
    :shell-title="data.setName"
    :handles="[
      {
        id: 'add-table-handle',
        type: 'source',
        position: Position.Right,
        color: 'info',
      },
    ]"
  >
    <div class="preview-body">
      <div class="description">{{ t('tableSetRootNode.tableCollectionManagement') }}</div>
      <div class="handle-section">
        <div class="handle-label">{{ t('tableSetRootNode.addTable') }}:</div>
        <div class="handle-info">{{ t('tableSetRootNode.newTable') }}</div>
      </div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import type { TableSetRootNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const props = defineProps<{
    id: string
    data: TableSetRootNodeData
  }>()

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const store = useGraphStore()
  const { t } = useI18n()
</script>

<style scoped src="./TableSetRootNode.styles.css"></style>

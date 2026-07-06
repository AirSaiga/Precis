/** * @file TableSetRootNode.vue * @description 表集合根节点组件 * * 核心功能： * -
作为表集合的顶层容器 * - 显示所有数据表节点的入口 * - 提供创建新数据表节点的入口 * * 节点结构： * -
Header：根节点图标、标题 * - Content：表集合内容区域 */
<template>
  <GraphNodeFrame
    class="table-set-root-node graph-node"
    theme="info"
    icon-name="folder-open"
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
  import type { TableSetRootNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  defineProps<{
    id: string
    data: TableSetRootNodeData
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./TableSetRootNode.styles.css"></style>

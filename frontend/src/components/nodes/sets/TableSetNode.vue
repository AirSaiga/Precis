<!--
  @file TableSetNode.vue
  @description 表集合节点组件 - 组织和展示多个数据表的集合
-->

/** * @file TableSetNode.vue * @description 表集合节点组件 * * 核心功能： * -
组织和显示多个数据表（Table）的集合 * - 显示集合内的表数量统计 * - 支持批量操作 * * 节点结构： * -
Header：集合图标、名称、表数量 * - Content：表列表预览 */
<template>
  <GraphNodeFrame
    class="table-set-node graph-node"
    :selected="selected"
    theme="primary"
    icon="📦"
    :title="data.setName"
    :shell-title="data.setName"
    :handles="[
      {
        id: `${id}-target`,
        type: 'target',
        position: Position.Left,
        color: 'secondary',
      },
      {
        id: `${id}-source`,
        type: 'source',
        position: Position.Right,
        color: 'primary',
      },
    ]"
  >
    <div class="preview-body">
      <div class="stat-row">
        <span class="label">{{ t('customNodes.tableSetNode.containsTables') }}:</span>
        <span class="value">{{ stats.tableCount }} {{ t('customNodes.tableSetNode.count') }}</span>
      </div>
      <div class="hint">{{ t('customNodes.tableSetNode.doubleClickEdit') }}</div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import type { TableSetNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  const props = defineProps<{
    id: string
    data: TableSetNodeData
    selected?: boolean
  }>()

  const store = useGraphStore()
  const { t } = useI18n()

  // 获取内部统计信息
  const stats = computed(() => store.getSubGraphStats(props.id))
</script>

<style scoped src="./TableSetNode.styles.css"></style>

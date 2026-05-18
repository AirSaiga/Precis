<!--
  @file SchemaSetNode.vue
  @description Schema集合节点组件 - 组织和展示多个Schema节点的集合
-->

/** * @file SchemaSetNode.vue * @description Schema集合节点组件 * * 核心功能： * - 组织和显示多个
Schema 节点的集合 * - 显示集合内的 Schema 数量统计 * - 支持批量操作 * * 节点结构： * -
Header：集合图标、名称、Schema 数量 * - Content：Schema 节点列表预览 */
<template>
  <GraphNodeFrame
    class="schema-set-node graph-node"
    :selected="selected"
    theme="info"
    icon="🗄️"
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
        color: 'info',
      },
    ]"
  >
    <div class="preview-body">
      <div class="stat-row">
        <span class="label">{{ t('customNodes.schemaSetNode.containsSchema') }}:</span>
        <span class="value"
          >{{ stats.schemaCount }} {{ t('customNodes.schemaSetNode.count') }}</span
        >
      </div>
      <div v-if="data.description" class="description">
        {{ data.description }}
      </div>
      <div class="hint">{{ t('customNodes.schemaSetNode.doubleClickEdit') }}</div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import type { SchemaSetNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  const props = defineProps<{
    id: string
    data: SchemaSetNodeData
    selected?: boolean
  }>()

  const store = useGraphStore()
  const { t } = useI18n()

  // 获取内部统计信息
  const stats = computed(() => {
    // 获取所有连接到该 SchemaSet 的边
    const connectedEdges = store.edges.filter((edge) => edge.target === props.id)
    // 找到源节点并过滤出 Schema 类型的节点
    const schemaNodes = connectedEdges
      .map((edge) => store.nodes.find((node) => node.id === edge.source))
      .filter((node) => node?.type === 'schema')

    return {
      schemaCount: schemaNodes.length,
    }
  })
</script>

<style scoped src="./SchemaSetNode.styles.css"></style>

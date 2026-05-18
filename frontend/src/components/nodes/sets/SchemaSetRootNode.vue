/** * @file SchemaSetRootNode.vue * @description Schema集合根节点组件 * * 核心功能： * - 作为 Schema
集合的顶层容器 * - 显示所有 Schema 节点的入口 * - 提供创建新 Schema 节点的入口 * * 节点结构： * -
Header：根节点图标、标题 * - Content：Schema 集合内容区域 */
<template>
  <GraphNodeFrame
    class="schema-set-root-node graph-node"
    theme="primary"
    icon="📂"
    :title="data.setName"
    :shell-title="data.setName"
    :handles="[
      {
        id: 'add-schema-handle',
        type: 'source',
        position: Position.Right,
        color: 'primary',
      },
    ]"
  >
    <div class="preview-section">
      <div class="stats">
        {{ t('schemaSetRootNode.contains') }} <strong>{{ schemaCount }}</strong>
        {{ t('schemaSetRootNode.tables') }}
      </div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import type { SchemaSetRootNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  const props = defineProps<{
    id: string
    data: SchemaSetRootNodeData
  }>()

  const store = useGraphStore()
  const { t } = useI18n()

  // 计算包含的Schema数量
  const schemaCount = computed(() => {
    return store.nodes.filter((node) => node.type === 'schema').length
  })
</script>

<style scoped src="./SchemaSetRootNode.styles.css"></style>

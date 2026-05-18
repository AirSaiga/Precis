<!--
  @file RegexSetNode.vue
  @description Regex集合节点组件 - 组织和展示多个Regex节点的集合
-->

/** * @file RegexSetNode.vue * @description Regex集合节点组件 * * 核心功能： * - 组织和显示多个
Regex 节点的集合 * - 显示集合内的 Regex 数量统计 * - 支持批量操作 * * 节点结构： * -
Header：集合图标、名称、Regex 数量 * - Content：Regex 节点列表预览 */
<template>
  <GraphNodeFrame
    class="regex-set-node graph-node"
    :selected="selected"
    theme="purple"
    icon="🔤"
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
        color: 'purple',
      },
    ]"
  >
    <div class="preview-body">
      <div class="stat-row">
        <span class="label">{{ t('customNodes.regexSetNode.containsExpressions') }}:</span>
        <span class="value">{{ stats.regexCount }} {{ t('customNodes.regexSetNode.count') }}</span>
      </div>
      <div class="hint">{{ t('customNodes.regexSetNode.doubleClickEdit') }}</div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import type { RegexSetNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  const props = defineProps<{
    id: string
    data: RegexSetNodeData
    selected?: boolean
  }>()

  const store = useGraphStore()
  const { t } = useI18n()

  // 获取内部统计信息
  const stats = computed(() => store.getSubGraphStats(props.id))
</script>

<style scoped src="./RegexSetNode.styles.css"></style>

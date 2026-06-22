/** * @file RegexSetRootNode.vue * @description Regex集合根节点组件 * * 核心功能： * - 作为 Regex
集合的顶层容器 * - 显示所有 Regex 节点的入口 * - 提供创建新 Regex 节点的入口 * * 节点结构： * -
Header：根节点图标、标题 * - Content：Regex 集合内容区域 */
<template>
  <GraphNodeFrame
    class="regex-set-root-node graph-node"
    theme="purple"
    icon="📁"
    :title="data.setName"
    :shell-title="data.setName"
    :handles="[
      {
        id: 'add-regex-handle',
        type: 'source',
        position: Position.Right,
        color: 'purple',
      },
    ]"
  >
    <div class="preview-body">
      <div class="description">
        {{ data.description || t('customNodes.regexSetRootNode.regexCollectionManagement') }}
      </div>
      <div class="handle-section">
        <div class="handle-label">{{ t('customNodes.regexSetRootNode.addRegex') }}：</div>
        <div class="handle-info">{{ t('customNodes.regexSetRootNode.newRegex') }}</div>
      </div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import type { RegexSetRootNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const props = defineProps<{
    id: string
    data: RegexSetRootNodeData
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./RegexSetRootNode.styles.css"></style>

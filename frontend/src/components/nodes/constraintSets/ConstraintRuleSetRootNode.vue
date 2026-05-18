/** * @file ConstraintRuleSetRootNode.vue * @description 约束规则集合根节点组件 * * 核心功能： * -
作为约束规则集合的顶层容器 * - 显示所有约束规则节点的入口 * - 提供创建新约束规则节点的入口 * *
节点结构： * - Header：根节点图标、标题 * - Content：约束规则集合内容区域 */
<template>
  <GraphNodeFrame
    class="constraint-rule-set-root-node graph-node"
    theme="danger"
    icon="🔒"
    :title="data.setName"
    :shell-title="data.setName"
    :handles="[
      {
        id: 'add-constraint-rule-handle',
        type: 'source',
        position: Position.Right,
        color: 'danger',
      },
    ]"
  >
    <div class="preview-body">
      <div class="description">
        {{ t('customNodes.constraintRules.constraintRuleSetRootNode.constraintRuleSetManagement') }}
      </div>
      <div class="handle-section">
        <div class="handle-label">
          {{ t('customNodes.constraintRules.constraintRuleSetRootNode.addConstraintRule') }}：
        </div>
        <div class="handle-info">
          {{ t('customNodes.constraintRules.constraintRuleSetRootNode.newConstraintRule') }}
        </div>
      </div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import type { ConstraintRuleSetRootNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  const props = defineProps<{
    id: string
    data: ConstraintRuleSetRootNodeData
  }>()

  const store = useGraphStore()
  const { t } = useI18n()
</script>

<style scoped src="./ConstraintRuleSetRootNode.styles.css"></style>

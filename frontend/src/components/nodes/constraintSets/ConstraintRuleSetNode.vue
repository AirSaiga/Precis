/** * @file ConstraintRuleSetNode.vue * @description 约束规则集合节点组件 * * 核心功能： * -
组织和显示多个约束规则节点的集合 * - 显示集合内的约束数量统计 * - 支持批量操作 * * 节点结构： * -
Header：集合图标、名称、约束数量 * - Content：约束节点列表预览 */
<template>
  <GraphNodeFrame
    class="constraint-rule-set-node graph-node"
    :selected="selected"
    theme="danger"
    icon-name="lock"
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
        color: 'danger',
      },
    ]"
  >
    <div class="preview-body">
      <div class="stat-row">
        <span class="label"
          >{{ t('customNodes.constraintRules.constraintRuleSetNode.constraintRules') }}:</span
        >
        <span class="value"
          >{{ stats.ruleCount }}
          {{ t('customNodes.constraintRules.constraintRuleSetNode.count') }}</span
        >
      </div>
      <div class="hint">
        {{ t('customNodes.constraintRules.constraintRuleSetNode.doubleClickEdit') }}
      </div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import type { ConstraintRuleSetNodeData } from '@/types/graph'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  const props = defineProps<{
    id: string
    data: ConstraintRuleSetNodeData
    selected?: boolean
  }>()

  const store = useGraphStore()
  const { t } = useI18n()

  // 获取内部统计信息
  const stats = computed(() => store.getSubGraphStats(props.id))
</script>

<style scoped src="./ConstraintRuleSetNode.styles.css"></style>

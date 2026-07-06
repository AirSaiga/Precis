<!--
  @file PatternNode.vue
  @description 模式显示节点组件 - 正则模式名称与表达式预览
-->

/** * @file PatternNode.vue * @description 模式显示节点组件 * * 核心功能： * - 显示模式名称 * -
显示截断的正则表达式预览 * - 提供输出 Handle 连接到 Regex 节点 * * 数据流： * PatternNode → [output
Handle] → RegexNode * * 节点结构： * - Header：模式图标和名称 * - Pattern
Preview：正则表达式截断预览 * - 右侧输出 Handle：连接到 Regex 节点 */
<template>
  <GraphNodeFrame
    class="pattern-node"
    :selected="selected"
    theme="sky"
    icon-name="clipboard"
    :title="data.name"
    :shell-title="data.name"
    :handles="[
      {
        id: 'pattern-output',
        type: 'source',
        position: Position.Right,
        color: 'sky',
        connected: selected,
        title: t('customNodes.patternNode.handleTitle'),
      },
    ]"
  >
    <div class="content-body">
      <div v-if="data.pattern" class="pattern-preview">
        <code class="pattern-text">{{ truncatedPattern }}</code>
      </div>

      <div class="meta-row">
        <span class="registry-badge" :class="data.registry">
          {{ registryLabel }}
        </span>
      </div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import type { PatternNodeData } from '@/features/regex/types'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'

  const { t } = useI18n()

  const props = defineProps<{
    data: PatternNodeData
    selected?: boolean
  }>()

  const truncatedPattern = computed(() => {
    if (!props.data.pattern) return ''
    const maxLength = 50
    if (props.data.pattern.length <= maxLength) return props.data.pattern
    return props.data.pattern.substring(0, maxLength) + '...'
  })

  const registryLabel = computed(() => {
    return t('customNodes.patternNode.standard')
  })
</script>

<style scoped src="./PatternNode.styles.css"></style>

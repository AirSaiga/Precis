<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
/** * @file PatternToolboxNode.vue * @description 模式工具箱节点组件 * * 核心功能： * -
显示多个模式条目的列表 * - 每个条目可独立拖拽或连接到 Regex 节点 * - 支持模式搜索过滤 * -
显示模式分类信息 * * 数据流： * PatternToolboxNode → [多个 output Handles] → 多个 RegexNode * *
节点结构： * - Header：工具箱图标和标题 * - Search Bar：模式搜索过滤 * - Pattern
List：模式条目列表（每个条目有独立输出 Handle） */
<template>
  <GraphNodeFrame
    class="pattern-toolbox-node graph-node"
    :selected="selected"
    theme="sky"
    icon-name="pattern-toolbox"
    :title="titleText"
    :shell-title="titleText"
  >
    <div class="content-body">
      <div v-if="!data.patterns || data.patterns.length === 0" class="empty">
        {{ t('customNodes.patternToolboxNode.empty') }}
      </div>

      <div v-else class="pattern-list">
        <div v-for="p in data.patterns" :key="p.id" class="pattern-row" :title="p.name">
          <span class="pattern-name">{{ p.name }}</span>
          <NodeHandle
            :id="`pattern-${p.id}`"
            type="source"
            :position="Position.Right"
            color="sky"
            size="lg"
            :title="t('customNodes.patternToolboxNode.handleTitle')"
          />
        </div>
      </div>
    </div>
  </GraphNodeFrame>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Position } from '@vue-flow/core'
  import GraphNodeFrame from '@/components/nodes/shared/GraphNodeFrame.vue'
  import NodeHandle from '@/components/ui/NodeHandle.vue'

  const { t } = useI18n()

  interface Props {
    data: {
      scope: string
      patterns: Array<{ id: string; name: string }>
    }
    selected?: boolean
  }

  defineProps<Props>()

  const titleText = computed(() => {
    return t('customNodes.patternToolboxNode.title')
  })
</script>

<style scoped src="./PatternToolboxNode.styles.css"></style>

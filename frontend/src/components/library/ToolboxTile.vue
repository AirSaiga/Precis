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
<!--
  @file ToolboxTile.vue
  @description 工具箱单个磁贴组件

  提供可拖拽的组件磁贴，包含图标、标签和操作图标。
-->

<template>
  <div
    class="component-tile"
    :draggable="draggable"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
    :title="tool.label"
  >
    <div class="tile-icon" :class="tool.iconClass" v-html="tool.iconSvg"></div>
    <span class="tile-label">{{ tool.label }}</span>
    <span v-if="$slots.action" class="tile-action" @click.stop>
      <slot name="action" />
    </span>
  </div>
</template>

<script setup lang="ts">
  /** 工具配置 */
  export interface ToolboxTool {
    id: string
    label: string
    iconClass: string
    iconSvg: string
  }

  interface Props {
    tool: ToolboxTool
    draggable?: boolean
  }

  defineProps<Props>()

  const emit = defineEmits<{
    dragstart: [event: DragEvent]
    dragend: []
  }>()
</script>

<style scoped src="./ToolboxTile.styles.css"></style>

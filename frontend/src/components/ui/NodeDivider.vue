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
  @file NodeDivider.vue
  @description 节点内部分隔线组件

  功能概述：
  - 统一节点内部视觉分割线样式
  - 支持实线和虚线两种变体
  - 支持多种主题颜色和间距尺寸

  Props：
  - variant: 'solid' | 'dashed' — 分隔线样式变体
  - spacing: 'sm' | 'md' | 'lg' — 上下间距大小
  - theme: 'neutral' | NodeTheme — 主题颜色

  Emits：
  - 无
-->
<template>
  <div
    class="node-divider"
    :class="[`variant-${variant}`, `spacing-${spacing}`, `theme-${theme}`]"
  />
</template>

<script setup lang="ts">
  /**
   * @file NodeDivider.vue
   * @description 节点分隔线组件 - 统一管理内部分割线样式
   *
   * 核心职责：
   * - 统一内部分割线样式
   * - 支持实线/虚线变体
   *
   * 使用方式：
   * <NodeDivider variant="solid" spacing="md" />
   */

  import type { NodeTheme } from './nodeVariants'

  type DividerVariant = 'solid' | 'dashed'
  type DividerSpacing = 'sm' | 'md' | 'lg'
  type DividerTheme = 'neutral' | NodeTheme

  interface Props {
    variant?: DividerVariant
    spacing?: DividerSpacing
    theme?: DividerTheme
  }

  withDefaults(defineProps<Props>(), {
    variant: 'solid',
    spacing: 'md',
    theme: 'neutral',
  })
</script>

<style scoped src="./NodeDivider.styles.css"></style>

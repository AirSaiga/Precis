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

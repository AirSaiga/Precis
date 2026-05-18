<!--
  @file InspectorBadge.vue
  @description Inspector 面板标签徽章

  功能概述：
  - 显示带状态色的徽章标签
  - 支持可选图标和多种状态样式

  Props：
  - text: string — 徽章文字
  - icon: string — 可选图标
  - status: 'connected' | 'disconnected' | 'error' | 'success' | 'warning' | 'default' — 状态样式

  Emits：
  - 无
-->
<template>
  <span class="inspector-badge" :class="`badge-status-${status}`">
    <span v-if="icon" class="badge-icon">{{ icon }}</span>
    <span class="badge-text">{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
  interface Props {
    text?: string
    icon?: string
    status?: 'connected' | 'disconnected' | 'error' | 'success' | 'warning' | 'default'
  }

  withDefaults(defineProps<Props>(), {
    text: '',
    icon: '',
    status: 'default',
  })
</script>

<style scoped src="./InspectorBadge.styles.css"></style>

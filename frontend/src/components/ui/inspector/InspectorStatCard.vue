<!--
  @file InspectorStatCard.vue
  @description Inspector 统计卡片

  功能概述：
  - 展示带图标和状态色的统计数值
  - 支持自定义标签和数值格式化

  Props：
  - icon: string — 图标（默认 '📊'）
  - value: string | number — 统计数值
  - label: string — 统计标签
  - status: 'default' | 'success' | 'warning' | 'error' — 状态样式

  Emits：
  - 无
-->
<template>
  <div class="inspector-stat-card" :class="`stat-status-${status}`">
    <div class="stat-icon" :class="`icon-bg-${status}`">
      <span class="icon-emoji">{{ icon }}</span>
    </div>
    <div class="stat-content">
      <div class="stat-value">{{ displayValue }}</div>
      <div class="stat-label">{{ label }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'

  interface Props {
    icon?: string
    value?: string | number
    label?: string
    status?: 'default' | 'success' | 'warning' | 'error'
  }

  const props = withDefaults(defineProps<Props>(), {
    icon: '📊',
    value: '-',
    label: '',
    status: 'default',
  })

  const displayValue = computed(() => {
    if (props.value === undefined || props.value === null) {
      return '-'
    }
    return String(props.value)
  })
</script>

<style scoped src="./InspectorStatCard.styles.css"></style>

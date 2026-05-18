<!--
  @file ZoneGroup.vue
  @description 区域分组组件

  功能概述：
  - 作为 Vue Flow 自定义节点渲染区域分组
  - 根据分类显示不同颜色和透明度
  - 支持折叠按钮控制子节点显隐

  Props：
  - id: string — 节点唯一标识（Vue Flow NodeProps）
  - data.group: ZoneGroup — 分组数据对象

  Emits：
  - toggle-collapse: [id: string] — 切换分组折叠状态
-->
<template>
  <div
    class="zone-group-node"
    :class="{ 'zone-group--nested': isNested, 'zone-group--root': !isNested }"
    :style="containerStyle"
  >
    <!-- 标题栏 -->
    <div class="zone-group-header" :style="headerStyle">
      <span class="zone-group-title" :style="{ fontSize: fontSize + 'px' }">
        {{ data.group.name }}
      </span>

      <div
        v-if="showCollapseButton"
        class="zone-group-collapse-btn"
        @click.stop="$emit('toggle-collapse', id)"
      >
        {{ data.group.collapsed ? '+' : '-' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { NodeProps } from '@vue-flow/core'
  import type { ZoneGroup } from '../types'

  // VueFlow 自定义节点接收的 props
  const props = defineProps<
    NodeProps<{
      group: ZoneGroup
    }>
  >()

  const isNested = computed(() => {
    return props.data.group.depth !== undefined && props.data.group.depth > 0
  })

  const fontSize = computed(() => {
    return isNested.value ? 11 : 13
  })

  const showCollapseButton = computed(() => {
    return props.data.group.nodeIds.length > 6
  })

  // 计算样式
  const containerStyle = computed(() => {
    const group = props.data.group
    const colors: Record<string, string> = {
      root: 'rgba(76, 175, 80, 0.15)',
      core: 'rgba(33, 150, 243, 0.15)',
      library: 'rgba(156, 39, 176, 0.15)',
      constraint: 'rgba(255, 152, 0, 0.15)',
    }

    let baseColor = colors[group.category] || 'rgba(33, 150, 243, 0.15)'
    if (isNested.value) {
      baseColor = baseColor.replace(/0\.15$/, '0.1')
    }

    return {
      width: `${group.width}px`,
      height: `${group.height}px`,
      backgroundColor: baseColor,
      border: `${isNested.value ? 1 : 2}px solid ${group.color}`,
      borderRadius: `${isNested.value ? 4 : 8}px`,
      opacity: isNested.value ? 0.5 : 0.85,
    }
  })

  const headerStyle = computed(() => {
    const group = props.data.group
    return {
      backgroundColor: group.color,
      opacity: isNested.value ? 0.15 : 0.2,
      height: `${isNested.value ? 22 : 28}px`,
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      padding: '0 10px',
      boxSizing: 'border-box' as const,
      borderTopLeftRadius: `${isNested.value ? 3 : 7}px`,
      borderTopRightRadius: `${isNested.value ? 3 : 7}px`,
    }
  })
</script>

<style scoped src="./ZoneGroup.styles.css"></style>

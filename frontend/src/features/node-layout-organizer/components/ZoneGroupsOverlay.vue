<!--
  @file ZoneGroupsOverlay.vue
  @description 多区域分组覆盖层

  功能概述：
  - 统一管理多个 ZoneGroupOverlay 的渲染层级
  - 根据视口变换应用全局缩放和位移
  - 按深度排序确保正确的层级叠加

  Props：
  - groups: ZoneGroup[] — 分组列表
  - viewport: ViewportTransform — Vue Flow 视口变换

  Emits：
  - toggle-collapse: [groupId: string] — 切换分组折叠状态
  - close: [groupId: string] — 关闭分组
  - drag-end: [groupId: string, deltaX: number, deltaY: number] — 拖动结束
-->
<template>
  <div class="zone-groups-layer" :style="layerStyle">
    <ZoneGroupOverlay
      v-for="group in orderedGroups"
      :key="group.id"
      :group="group"
      @toggle-collapse="emit('toggle-collapse', $event)"
      @close="emit('close', $event)"
      @drag-end="handleDragEnd"
    />
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { ViewportTransform } from '@vue-flow/core'
  import type { ZoneGroup } from '../types'
  import ZoneGroupOverlay from './ZoneGroupOverlay.vue'

  const props = defineProps<{
    groups: ZoneGroup[]
    viewport: ViewportTransform
  }>()

  const emit = defineEmits<{
    (e: 'toggle-collapse', groupId: string): void
    (e: 'close', groupId: string): void
    (e: 'drag-end', groupId: string, deltaX: number, deltaY: number): void
  }>()

  function handleDragEnd(groupId: string, deltaX: number, deltaY: number) {
    emit('drag-end', groupId, deltaX, deltaY)
  }

  const orderedGroups = computed(() => {
    return props.groups.slice().sort((a, b) => (a.depth || 0) - (b.depth || 0))
  })

  const layerStyle = computed(() => {
    const { x, y, zoom } = props.viewport
    return {
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
      transformOrigin: '0 0',
      position: 'absolute' as const,
      inset: 0,
      pointerEvents: 'none' as const,
    }
  })
</script>

<style scoped src="./ZoneGroupsOverlay.styles.css"></style>

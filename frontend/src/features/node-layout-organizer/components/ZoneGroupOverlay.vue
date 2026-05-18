<!--
  @file ZoneGroupOverlay.vue
  @description 区域分组覆盖层

  功能概述：
  - 渲染可拖动的区域分组覆盖层
  - 支持拖动整个分组及其内部节点
  - 提供折叠和关闭操作按钮

  Props：
  - group: ZoneGroup — 分组数据对象

  Emits：
  - toggle-collapse: [groupId: string] — 切换分组折叠状态
  - close: [groupId: string] — 关闭并隐藏分组
  - drag-end: [groupId: string, deltaX: number, deltaY: number] — 拖动结束
-->
<template>
  <div
    ref="overlayRef"
    class="zone-group-overlay"
    :class="{
      'zone-group--nested': isNested,
      'zone-group--root': !isNested,
      'is-dragging': isDragging,
    }"
    :style="containerStyle"
  >
    <div class="zone-group-header" :style="headerStyle" @mousedown.stop.prevent="onHeaderMouseDown">
      <span class="zone-group-title" :style="{ fontSize: fontSize + 'px' }">
        {{ group.name }}
      </span>

      <div class="zone-group-actions">
        <div
          v-if="showCollapseButton"
          class="zone-group-collapse-btn"
          @click.stop="emit('toggle-collapse', group.id)"
        >
          {{ group.collapsed ? '+' : '-' }}
        </div>
        <div
          class="zone-group-close-btn"
          @click.stop="emit('close', group.id)"
          title="隐藏该分组框"
        >
          ×
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import type { ZoneGroup } from '../types'

  const props = defineProps<{
    group: ZoneGroup
  }>()

  const emit = defineEmits<{
    (e: 'toggle-collapse', groupId: string): void
    (e: 'close', groupId: string): void
    (e: 'drag-end', groupId: string, deltaX: number, deltaY: number): void
  }>()

  const isNested = computed(() => (props.group.depth || 0) > 0)
  const fontSize = computed(() => (isNested.value ? 11 : 13))
  const showCollapseButton = computed(() => props.group.nodeIds.length > 6)
  const isDragging = ref(false)
  const overlayRef = ref<HTMLElement | null>(null)

  const containerStyle = computed(() => {
    const group = props.group
    const colors: Record<string, string> = {
      root: 'rgba(76, 175, 80, 0.12)',
      core: 'rgba(33, 150, 243, 0.10)',
      library: 'rgba(156, 39, 176, 0.10)',
      constraint: 'rgba(255, 152, 0, 0.10)',
    }

    let baseColor = colors[group.category] || 'rgba(33, 150, 243, 0.10)'
    if (isNested.value) {
      baseColor = baseColor.replace(/0\.10$/, '0.06')
    }

    return {
      left: `${group.x}px`,
      top: `${group.y}px`,
      width: `${group.width}px`,
      height: `${group.height}px`,
      backgroundColor: baseColor,
      border: `${isNested.value ? 1 : 2}px solid ${group.color}`,
      borderRadius: `${isNested.value ? 4 : 8}px`,
      boxShadow: isNested.value ? '0 2px 8px rgba(0,0,0,0.06)' : '0 4px 14px rgba(0,0,0,0.08)',
      transition: isDragging.value ? 'none' : 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    }
  })

  const headerStyle = computed(() => {
    const group = props.group
    const bgOpacity = isNested.value ? 0.12 : 0.18
    const rgb = hexToRgb(group.color)
    const backgroundColor = rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${bgOpacity})` : group.color

    return {
      backgroundColor,
      height: `${isNested.value ? 22 : 28}px`,
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      padding: '0 10px',
      boxSizing: 'border-box' as const,
      borderTopLeftRadius: `${isNested.value ? 3 : 7}px`,
      borderTopRightRadius: `${isNested.value ? 3 : 7}px`,
      cursor: isDragging.value ? 'grabbing' : 'grab',
    }
  })

  function onHeaderMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.zone-group-actions')) return

    e.preventDefault()
    e.stopImmediatePropagation()
    isDragging.value = true

    const overlayEl = overlayRef.value
    if (!overlayEl) {
      isDragging.value = false
      return
    }

    // 收集需要跟随拖动的 DOM 元素
    const nodeElements: HTMLElement[] = []
    for (const nodeId of props.group.nodeIds) {
      const el =
        (document.querySelector(`.vue-flow__node[data-id="${nodeId}"]`) as HTMLElement | null) ||
        (document.querySelector(`[data-id="${nodeId}"] .vue-flow__node`) as HTMLElement | null)
      if (el) nodeElements.push(el)
    }

    // 记录每个元素的原始 transform
    const originalTransforms = new Map<HTMLElement, string>()
    originalTransforms.set(overlayEl, overlayEl.style.transform)
    for (const el of nodeElements) {
      originalTransforms.set(el, el.style.transform)
    }

    let totalDeltaX = 0
    let totalDeltaY = 0

    const onMouseMove = (ev: MouseEvent) => {
      totalDeltaX += ev.movementX
      totalDeltaY += ev.movementY

      const t = `translate(${totalDeltaX}px, ${totalDeltaY}px)`
      overlayEl.style.transform = t
      for (const el of nodeElements) {
        const orig = originalTransforms.get(el) || ''
        el.style.transform = orig ? `${orig} ${t}` : t
      }
    }

    const onMouseUp = () => {
      isDragging.value = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)

      // 恢复原始 transform
      overlayEl.style.transform = originalTransforms.get(overlayEl) || ''
      for (const el of nodeElements) {
        el.style.transform = originalTransforms.get(el) || ''
      }

      if (Math.abs(totalDeltaX) > 2 || Math.abs(totalDeltaY) > 2) {
        emit('drag-end', props.group.id, totalDeltaX, totalDeltaY)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null
  }
</script>

<style scoped src="./ZoneGroupOverlay.styles.css"></style>

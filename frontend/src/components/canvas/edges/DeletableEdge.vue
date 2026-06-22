<!--
  @file DeletableEdge.vue
  @description 可删除的自定义边组件 — 鼠标悬停时显示删除按钮
-->

<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { getSmoothStepPath, BaseEdge, useVueFlow } from '@vue-flow/core'
  import type { EdgeProps } from '@vue-flow/core'
  const props = defineProps<EdgeProps>()

  const { removeEdges } = useVueFlow()
  const isHovered = ref(false)

  const isDeletable = computed(() => {
    const data = props.data as Record<string, unknown> | undefined
    if (!data) return true
    if (data.transient) return false
    if (data.kind === 'fkDisplay') return false
    return true
  })

  const pathData = computed(() => {
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      targetX: props.targetX,
      targetY: props.targetY,
      targetPosition: props.targetPosition,
      borderRadius: 5,
    })
    return { path, labelX, labelY }
  })

  function handleMouseEnter() {
    if (isDeletable.value) {
      isHovered.value = true
    }
  }

  function handleMouseLeave() {
    isHovered.value = false
  }

  function handleDelete(event: MouseEvent) {
    event.stopPropagation()
    removeEdges([props.id])
  }
</script>

<template>
  <g @mouseenter="handleMouseEnter" @mouseleave="handleMouseLeave">
    <BaseEdge
      :path="pathData.path"
      :style="props.style"
      :marker-end="props.markerEnd"
      :marker-start="props.markerStart"
      :animated="props.animated"
      :label="props.label"
      :label-style="props.labelStyle"
      :label-show-bg="props.labelShowBg"
      :label-bg-style="props.labelBgStyle"
      :label-bg-padding="props.labelBgPadding"
      :label-bg-border-radius="props.labelBgBorderRadius"
    />

    <g
      v-if="isHovered && isDeletable"
      class="edge-delete-button"
      :transform="`translate(${pathData.labelX}, ${pathData.labelY})`"
      @click.stop="handleDelete"
    >
      <circle r="9" class="edge-delete-button__bg" />
      <line x1="-4" y1="-4" x2="4" y2="4" class="edge-delete-button__icon" />
      <line x1="4" y1="-4" x2="-4" y2="4" class="edge-delete-button__icon" />
    </g>
  </g>
</template>

<style scoped>
  .edge-delete-button {
    cursor: pointer;
  }

  .edge-delete-button__bg {
    fill: var(--ui-bg-danger, #ef4444);
    opacity: 0.9;
    transition: opacity 0.15s ease;
  }

  .edge-delete-button:hover .edge-delete-button__bg {
    opacity: 1;
    r: 10;
  }

  .edge-delete-button__icon {
    stroke: white;
    stroke-width: 2;
    stroke-linecap: round;
  }
</style>

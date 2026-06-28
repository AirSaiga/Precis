<!--
  @file DeletableEdge.vue
  @description 可删除的自定义边组件 — 鼠标悬停时显示删除按钮
-->

<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { getSmoothStepPath, BaseEdge, useVueFlow } from '@vue-flow/core'
  import type { EdgeProps } from '@vue-flow/core'
  import { getParticleColorClass, shouldRenderParticles } from '@/utils/edgeParticleColor'
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

  // C 层：边校验状态（从 props.data 读取，默认 idle）
  const particleStatus = computed(() => {
    const data = props.data as Record<string, unknown> | undefined
    return (data?.validationStatus as 'idle' | 'pass' | 'error' | 'missing' | undefined) ?? 'idle'
  })
  const showParticles = computed(() => shouldRenderParticles(particleStatus.value))
  const particleClass = computed(() => getParticleColorClass(particleStatus.value))

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

    <!-- C 层：校验状态粒子流（idle 态不渲染，边保持静态线） -->
    <g v-if="showParticles" class="edge-particles">
      <circle v-for="i in 3" :key="i" r="3" :class="['edge-particle', particleClass]">
        <animateMotion
          :path="pathData.path"
          dur="2s"
          repeatCount="indefinite"
          :begin="`${(i - 1) * 0.5}s`"
        />
      </circle>
    </g>

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

  /* C 层：边粒子颜色由 class 驱动（reduced-motion 下停止流动但仍着色） */
  .edge-particle {
    filter: drop-shadow(0 0 3px currentColor);
  }
  .edge-particle.particle--pass {
    fill: #34d399;
    color: #4cd7a8;
  }
  .edge-particle.particle--error {
    fill: #fb7185;
    color: #ff8a8a;
  }
  .edge-particle.particle--missing {
    fill: #fbbf24;
    color: #f9c66b;
  }
</style>

<!--
  @file DragGhost.vue
  @description 拖拽幽灵组件

  在拖拽操作期间跟随鼠标显示的半透明预览元素，
  展示被拖拽资源的图标和名称。

  Props:
  - payload: 拖拽负载数据（包含类型、名称、图标）
  - mousePosition: 当前鼠标位置（用于定位）
-->

<template>
  <div class="drag-ghost" :class="ghostClass" :style="ghostStyle">
    <div class="ghost-icon">{{ icon }}</div>
    <div class="ghost-divider">|</div>
    <div class="ghost-label">{{ label }}</div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import type { ResourceDragPayload } from '@/stores/resourceDragStore'

  interface Props {
    payload: ResourceDragPayload
    mousePosition?: { x: number; y: number }
  }

  const props = defineProps<Props>()

  const getCssVar = (name: string, fallback: string) => {
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      return value || fallback
    } catch {
      return fallback
    }
  }

  const typeConfigs: Record<
    string,
    { color: string; borderColor: string; icon: string; label: string }
  > = {
    schema: {
      color: 'var(--node-accent-schema)',
      borderColor: 'var(--node-accent-schema)',
      icon: '🗃️',
      label: 'Schema',
    },
    pattern: {
      color: 'var(--node-accent-regex)',
      borderColor: 'var(--node-accent-regex)',
      icon: '🪄',
      label: 'Pattern',
    },
    constraint: {
      color: 'var(--node-accent-constraint)',
      borderColor: 'var(--node-accent-constraint)',
      icon: '🛡️',
      label: 'Constraint',
    },
    projectConfig: {
      color: 'var(--ui-accent)',
      borderColor: 'var(--ui-accent)',
      icon: '⚙️',
      label: 'project.yaml',
    },
    patternFolder: {
      color: 'var(--node-accent-regex)',
      borderColor: 'var(--node-accent-regex)',
      icon: '🧰',
      label: 'Patterns',
    },
    constraintFolder: {
      color: 'var(--node-accent-constraint)',
      borderColor: 'var(--node-accent-constraint)',
      icon: '📋',
      label: 'Constraints',
    },
    external_data_source: {
      color: 'var(--ui-accent)',
      borderColor: 'var(--ui-accent)',
      icon: '🧾',
      label: 'Data Source',
    },
  }

  const ghostStyle = computed(() => {
    const config = typeConfigs[props.payload.type] || typeConfigs.schema
    if (!config) {
      return {}
    }
    return {
      background: getCssVar('--ui-overlay-surface', 'rgba(39, 39, 42, 0.9)'),
      border: `1px solid ${getCssVar(config.borderColor.replace('var(', '').replace(')', ''), '#2563eb')}`,
      boxShadow: getCssVar('--ui-shadow-lg', '0 16px 48px rgba(15, 23, 42, 0.18)'),
      color: getCssVar('--ui-text-dark', '#e4e4e7'),
      position: 'fixed' as const,
      left: props.mousePosition?.x ? `${props.mousePosition.x + 10}px` : '10px',
      top: props.mousePosition?.y ? `${props.mousePosition.y + 10}px` : '10px',
      zIndex: 10000,
      pointerEvents: 'none' as const,
      transform: 'translate(-50%, -50%)',
    }
  })

  const ghostClass = computed(() => ['drag-ghost'])

  const icon = computed(() => {
    const config = typeConfigs[props.payload.type] || typeConfigs.schema
    return config?.icon ?? ''
  })

  const label = computed(() => {
    return props.payload.label || (typeConfigs[props.payload.type]?.label ?? 'Resource')
  })
</script>

<style scoped src="./DragGhost.styles.css"></style>

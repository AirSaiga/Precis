<!--
  @file NodeBadge.vue
  @description 节点徽标组件

  显示在节点头部的小徽章，用于展示状态计数（如错误数、子节点数）。
  支持多种类型（error、warning、success、info）和尺寸。

  Props:
  - type: 徽标类型（error/warning/success/info）
  - variant: 样式变体（filled/outlined）
  - count: 显示数字计数
  - clickable: 是否可点击
-->

<template>
  <component
    :is="clickable ? 'button' : 'span'"
    v-if="showBadge"
    class="node-badge"
    :class="[
      `type-${type}`,
      `variant-${variant}`,
      `size-${size}`,
      {
        'has-count': showCount,
        'is-clickable': clickable,
      },
    ]"
    :title="tooltip"
    :type="clickable ? 'button' : undefined"
    @click="handleClick"
  >
    <span v-if="showCount" class="node-badge__count">
      {{ displayCount }}
    </span>
    <span v-else class="node-badge__content">
      <slot />
    </span>
  </component>
</template>

<script setup lang="ts">
  /**
   * @file NodeBadge.vue
   * @description 节点徽章组件 - 统一管理状态徽章样式
   *
   * 核心职责：
   * - 统一状态徽章样式
   * - 支持数字显示和纯图标模式
   *
   * 使用方式：
   * <NodeBadge
   *   type="danger"
   *   :count="5"
   *   :show-zero="false"
   *   @click="handleClick"
   * />
   */

  import { computed } from 'vue'
  import type { NodeBadgeSize, NodeBadgeVariant, NodeTheme } from './nodeVariants'

  interface Props {
    type?: NodeTheme
    count?: number
    showZero?: boolean
    clickable?: boolean
    tooltip?: string
    maxCount?: number
    variant?: NodeBadgeVariant
    size?: NodeBadgeSize
  }

  const props = withDefaults(defineProps<Props>(), {
    type: 'danger',
    showZero: false,
    clickable: false,
    tooltip: '',
    maxCount: 99,
    variant: 'solid',
    size: 'xs',
  })

  const emit = defineEmits<{
    click: []
  }>()

  const showBadge = computed(() => {
    if (props.count === undefined || props.count === null) {
      return true
    }

    return props.showZero || props.count > 0
  })

  const showCount = computed(() => {
    return props.count !== undefined && props.count !== null
  })

  const displayCount = computed(() => {
    if (!showCount.value) {
      return ''
    }

    const count = props.count ?? 0
    if (count > props.maxCount) {
      return `${props.maxCount}+`
    }
    return count
  })

  function handleClick() {
    if (props.clickable) {
      emit('click')
    }
  }
</script>

<style scoped src="./NodeBadge.styles.css"></style>

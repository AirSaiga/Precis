<!--
  @file SelectionPopover.vue
  @description 正则选择气泡组件

  功能概述：
  - 根据选中文本位置智能定位气泡
  - 支持设为参数和取消选择操作
  - 自动处理视口边界和点击外部关闭

  Props：
  - selection: SelectionInfo — 选中文本信息（文本、位置、坐标）
  - containerRef: HTMLElement | null — 可选容器引用

  Emits：
  - defineAsParam: [] — 将选中文本设为参数
  - clear: [] — 清除选择并关闭气泡
-->
<template>
  <div
    class="selection-popover"
    :style="smartPopoverStyle"
    ref="popoverRef"
    :class="{ 'positioned-bottom': isPositionedBelow, 'positioned-top': !isPositionedBelow }"
  >
    <div class="popover-header">
      <div class="popover-text">"{{ selection.text }}"</div>
    </div>
    <div class="popover-actions">
      <button @click="$emit('defineAsParam')" class="btn-primary">
        {{ t('expressions.selectionPopover.setAsParameter') }}
      </button>
      <button
        @click="$emit('clear')"
        class="btn-close"
        :title="t('expressions.selectionPopover.cancelSelection')"
      >
        ×
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
  import { useI18n } from 'vue-i18n'

  interface SelectionInfo {
    text: string
    start: number
    end: number
    x: number
    y: number
  }

  interface Props {
    selection: SelectionInfo
    containerRef?: HTMLElement | null
  }

  const props = defineProps<Props>()
  const emit = defineEmits(['defineAsParam', 'clear'])

  const { t } = useI18n()

  const popoverRef = ref<HTMLElement | null>(null)
  // 计算弹窗位置（是否在下方）
  const isPositionedBelow = computed(() => {
    if (!props.selection.x || !props.selection.y) return true

    const viewportHeight = window.innerHeight
    const margin = 12
    const popoverHeight = 60

    const spaceBelow = viewportHeight - props.selection.y
    const spaceAbove = props.selection.y - margin

    return !(spaceBelow < popoverHeight + margin && spaceAbove > popoverHeight + margin)
  })

  // 计算智能定位样式
  const smartPopoverStyle = computed(() => {
    if (!props.selection.x || !props.selection.y) return {} as Record<string, string | number>

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const margin = 12 // 边距

    // 使用固定的弹窗尺寸估算
    const popoverWidth = 280
    const popoverHeight = 60

    // 使用传入的坐标（相对于视口）
    let left = props.selection.x
    let top = props.selection.y

    // 水平方向调整：确保弹窗在可视区域内
    if (left + popoverWidth > viewportWidth - margin) {
      left = Math.max(margin, viewportWidth - popoverWidth - margin)
    }

    // 垂直方向调整：优先显示在选中文字下方
    const spaceBelow = viewportHeight - top
    const spaceAbove = props.selection.y - margin

    // 如果下方空间不足且上方空间足够，则显示在上方
    if (spaceBelow < popoverHeight + margin && spaceAbove > popoverHeight + margin) {
      top = props.selection.y - popoverHeight - margin
    } else {
      top = props.selection.y + margin // 默认显示在下方
    }

    // 确保不超出左边界
    left = Math.max(margin, left)

    // 确保不超出上边界
    top = Math.max(margin, top)

    return {
      top: `${top}px`,
      left: `${left}px`,
      position: 'fixed' as const, // 使用fixed定位以确保相对于视口定位，使用as const确保类型安全
    }
  })

  // 监听窗口尺寸变化，重新计算位置
  const handleResize = () => {
    // 使用强制更新来重新计算位置
    window.dispatchEvent(new Event('resize'))
  }

  // 点击外部区域关闭弹窗
  const handleClickOutside = (event: MouseEvent) => {
    if (popoverRef.value && !popoverRef.value.contains(event.target as Node)) {
      emit('clear')
    }
  }

  onMounted(() => {
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('resize', handleResize)
  })

  onUnmounted(() => {
    document.removeEventListener('mousedown', handleClickOutside)
    window.removeEventListener('resize', handleResize)
  })
</script>

<style scoped src="./SelectionPopover.styles.css"></style>

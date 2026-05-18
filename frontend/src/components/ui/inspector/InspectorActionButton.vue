<!--
  @file InspectorActionButton.vue
  @description Inspector 面板操作按钮

  功能概述：
  - 提供带图标和文字的操作按钮
  - 支持危险样式和禁用状态

  Props：
  - icon: string — 按钮图标（默认 '▶'）
  - text: string — 按钮文字（默认 '操作'）
  - danger: boolean — 是否使用危险样式
  - disabled: boolean — 是否禁用

  Emits：
  - click: [event: MouseEvent] — 点击事件
-->
<template>
  <button
    class="inspector-action-btn"
    :class="{ 'btn-danger': danger, 'btn-disabled': disabled }"
    type="button"
    :disabled="disabled"
    @click="handleClick"
  >
    <span class="btn-icon">{{ icon }}</span>
    <span class="btn-text">{{ text }}</span>
  </button>
</template>

<script setup lang="ts">
  interface Props {
    icon?: string
    text?: string
    danger?: boolean
    disabled?: boolean
  }

  withDefaults(defineProps<Props>(), {
    icon: '▶',
    text: '操作',
    danger: false,
    disabled: false,
  })

  const emit = defineEmits<{
    click: [event: MouseEvent]
  }>()

  function handleClick(event: MouseEvent) {
    emit('click', event)
  }
</script>

<style scoped src="./InspectorActionButton.styles.css"></style>

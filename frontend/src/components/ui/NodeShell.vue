<!--
  @file NodeShell.vue
  @description 节点外壳基础组件

  为所有画布节点提供统一的可视化外壳，包括：
  - 选中/悬停/错误状态样式
  - 主题色适配（primary、success、danger 等）
  - 状态徽章（idle、success、error、warning）
  - 保存/删除按钮插槽
  - 错误数量徽章和点击事件

  Props:
  - selected: 是否选中
  - theme: 主题色
  - state: 状态（idle/success/error/warning）
  - hasError / errorCount: 错误指示
  - showDelete / showSave: 是否显示操作按钮
-->

<template>
  <div
    class="node-shell"
    :class="{
      'is-selected': selected,
      'has-error': resolvedHasError,
      [`state-${resolvedState}`]: true,
      [`theme-${theme}`]: true,
    }"
    :data-selected="selected"
    :data-has-error="resolvedHasError"
    :data-state="resolvedState"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <slot name="overlay" />

    <div v-if="$slots.header" class="node-shell__header">
      <slot name="header" />
    </div>

    <div v-if="$slots.default" class="node-shell__content">
      <slot />
    </div>

    <div v-if="$slots.footer" class="node-shell__footer">
      <slot name="footer" />
    </div>

    <button
      v-if="showDelete"
      class="node-shell__delete-btn"
      type="button"
      :title="deleteTitle"
      @mousedown.stop
      @click.stop="handleDelete"
    >
      ×
    </button>

    <NodeBadge
      v-if="resolvedHasError && errorCount > 0"
      class="node-shell__error-badge"
      type="danger"
      variant="solid"
      size="sm"
      clickable
      :count="errorCount"
      :max-count="99"
      :tooltip="errorTitle"
      @mousedown.stop
      @click.stop="handleErrorClick"
    />

    <button
      v-if="showSave"
      class="node-shell__save-btn"
      type="button"
      :disabled="isSaving"
      :title="saveTitle"
      @mousedown.stop
      @click.stop="handleSave"
    >
      {{ isSaving ? savingText : saveText }}
    </button>
  </div>
</template>

<script setup lang="ts">
  /**
   * @file NodeShell.vue
   * @description 节点外壳组件 - 统一管理节点容器形态
   *
   * 核心职责：
   * - 管理节点外部容器形态（边框、阴影、圆角）
   * - 处理选中、错误、悬浮状态
   * - 提供统一的删除按钮和错误徽章
   * - 暴露标准的事件接口
   *
   * 使用方式：
   * <NodeShell
   *   :selected="isSelected"
   *   :has-error="hasError"
   *   :error-count="5"
   *   :theme="'primary'"
   *   @delete="handleDelete"
   *   @error-click="handleErrorClick"
   * >
   *   <template #header>...</template>
   *   <template #default>...</template>
   *   <template #footer>...</template>
   * </NodeShell>
   */

  import { computed } from 'vue'
  import NodeBadge from './NodeBadge.vue'
  import type { NodeState, NodeTheme } from './nodeVariants'

  interface Props {
    selected?: boolean
    hasError?: boolean
    errorCount?: number
    theme?: NodeTheme
    state?: NodeState
    showDelete?: boolean
    showSave?: boolean
    isSaving?: boolean
    deleteTitle?: string
    errorTitle?: string
    saveTitle?: string
    saveText?: string
    savingText?: string
  }

  const props = withDefaults(defineProps<Props>(), {
    selected: false,
    hasError: false,
    errorCount: 0,
    theme: 'primary',
    state: 'idle',
    showDelete: true,
    showSave: false,
    isSaving: false,
    deleteTitle: 'Delete',
    errorTitle: 'View errors',
    saveTitle: 'Save',
    saveText: 'Save',
    savingText: 'Saving...',
  })

  const emit = defineEmits<{
    delete: []
    'error-click': []
    save: []
    'mouse-enter': []
    'mouse-leave': []
  }>()

  const resolvedHasError = computed(() => {
    return props.hasError || props.state === 'error' || props.errorCount > 0
  })

  const resolvedState = computed(() => {
    if (props.state === 'error' || resolvedHasError.value) {
      return 'error'
    }

    if (props.selected && props.state === 'idle') {
      return 'selected'
    }

    return props.state
  })

  function handleDelete() {
    emit('delete')
  }

  function handleErrorClick() {
    emit('error-click')
  }

  function handleSave() {
    emit('save')
  }

  function handleMouseEnter() {
    emit('mouse-enter')
  }

  function handleMouseLeave() {
    emit('mouse-leave')
  }
</script>

<style scoped src="./NodeShell.styles.css"></style>

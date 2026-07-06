<!--
  @file NodeHeader.vue
  @description 节点头部组件

  显示在节点顶部的标题栏，包含：
  - 图标（emoji 或自定义插槽）
  - 标题和副标题
  - 操作按钮插槽（保存、删除、编辑等）
  - 帮助提示按钮

  所有节点类型（Schema、Regex、Constraint 等）共享此头部组件。
-->

<template>
  <div
    class="node-header"
    :class="[
      `theme-${theme}`,
      `state-${status}`,
      { 'has-help': showHelp, 'has-subtitle': !!subtitle },
    ]"
  >
    <div v-if="iconName || $slots.icon" class="node-header__icon">
      <slot name="icon">
        <AppIcon v-if="iconName" :name="iconName" :size="16" />
      </slot>
    </div>

    <div class="node-header__title-area">
      <span class="node-header__title">{{ title }}</span>
      <span v-if="subtitle" class="node-header__subtitle">{{ subtitle }}</span>
    </div>

    <div v-if="$slots.actions" class="node-header__actions">
      <slot name="actions" />
    </div>

    <button
      v-if="showHelp"
      class="node-header__help-wrapper"
      type="button"
      :aria-label="helpText || title"
      @click.stop="handleHelpClick"
    >
      <span class="node-header__help">?</span>
      <div v-if="helpText" class="node-header__help-tooltip">
        {{ helpText }}
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
  /**
   * @file NodeHeader.vue
   * @description 节点头部组件 - 统一管理节点头部布局
   *
   * 核心职责：
   * - 统一节点头部布局（图标 + 标题 + 操作按钮）
   * - 支持主题变体（不同类型节点的头部颜色）
   * - 内置帮助按钮和提示
   *
   * 使用方式：
   * <NodeHeader
   *   icon-name="clipboard"
   *   title="节点标题"
   *   subtitle="可选副标题"
   *   theme="primary"
   *   :show-help="true"
   *   help-text="帮助信息"
   *   @help-click="handleHelp"
   * >
   *   <template #actions>自定义操作按钮</template>
   * </NodeHeader>
   */

  import AppIcon from '../icons/AppIcon.vue'
  import type { NodeState, NodeTheme } from './nodeVariants'
  interface Props {
    /** 业务图标名（对应 iconRegistry） */
    iconName?: string
    title: string
    subtitle?: string
    theme?: NodeTheme
    showHelp?: boolean
    helpText?: string
    status?: NodeState
  }

  withDefaults(defineProps<Props>(), {
    iconName: '',
    title: '',
    subtitle: '',
    theme: 'primary',
    showHelp: false,
    helpText: '',
    status: 'idle',
  })

  const emit = defineEmits<{
    'help-click': []
  }>()

  function handleHelpClick() {
    emit('help-click')
  }
</script>

<style scoped src="./NodeHeader.styles.css"></style>

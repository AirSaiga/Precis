<!--
  @file CanvasControls.vue
  @description 画布左下角自定义操作按钮：聚焦项目 + 整理节点
  与 Vue Flow Controls（缩放）并列显示
-->

<template>
  <div class="custom-controls">
    <button
      class="control-btn"
      :title="t('shortcuts.commands.focusProject') + ' (Ctrl+H)'"
      @click="focusToProjectRoot"
    >
      <span class="control-icon">&#x2316;</span>
    </button>

    <div class="control-separator"></div>

    <button
      class="control-btn"
      :disabled="nodeOrganizer.isOrganizing.value"
      :title="t('canvas.nodeCanvas.organizeNodes')"
      @click="nodeOrganizer.quickOrganize"
    >
      <span v-if="nodeOrganizer.isOrganizing.value" class="control-icon spinner">&#x229E;</span>
      <span v-else class="control-icon">&#x229E;</span>
    </button>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useCanvasLifecycle } from '@/composables/canvas/useCanvasLifecycle'
  import { useNodeOrganizer } from '@/features/node-layout-organizer/composables/useNodeOrganizer'

  const { t } = useI18n()
  const nodeOrganizer = useNodeOrganizer()
  const { focusToProjectRoot } = useCanvasLifecycle()
</script>

<style scoped>
  .custom-controls {
    position: absolute;
    bottom: 36px;
    left: 15px;
    display: flex;
    align-items: center;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-md);
    box-shadow: var(--ui-shadow-elevation-md);
    overflow: hidden;
    z-index: 5;
  }

  .control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    color: var(--ui-text-primary);
    font-size: 16px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .control-btn:hover:not(:disabled) {
    background: var(--ui-bg-hover);
  }

  .control-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .control-icon {
    display: inline-block;
    line-height: 1;
  }

  .control-icon.spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .control-separator {
    width: 1px;
    height: 16px;
    background: var(--ui-border-light);
  }
</style>

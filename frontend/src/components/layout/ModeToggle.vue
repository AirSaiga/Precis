<!--
  @file ModeToggle.vue
  @description IDE / Agent 双模式切换开关

  位于应用顶部的分段式（segmented）切换控件：
  - IDE 模式：现有的手动操作画布（ActivityBar + Sidebar + Canvas + Inspector）
  - Agent 模式：AI 全自动驱动画布（AI 面板 + 画布）

  直接绑定 appModeStore（Pinia），无需走 eventBus——store 状态即真相源。
  本组件在 IDE / Agent 两种布局下均渲染，确保随时可切换。
-->

<template>
  <div class="mode-toggle-wrapper" :title="t('aiChat.modeToggleTitle')">
    <!-- 滑动高亮背景，通过 transform 定位到激活段 -->
    <span
      class="mode-toggle-thumb"
      :class="{ 'is-agent': appModeStore.isAgentMode }"
      aria-hidden="true"
    ></span>
    <button
      type="button"
      class="mode-toggle-option"
      :class="{ active: !appModeStore.isAgentMode }"
      :title="t('aiChat.modeIdeHint')"
      @click="appModeStore.setMode('ide')"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
      <span class="mode-toggle-label">{{ t('aiChat.modeIde') }}</span>
    </button>
    <button
      type="button"
      class="mode-toggle-option"
      :class="{ active: appModeStore.isAgentMode }"
      :title="t('aiChat.modeAgentHint')"
      @click="appModeStore.setMode('agent')"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 2L9.5 9.5L2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z"></path>
      </svg>
      <span class="mode-toggle-label">{{ t('aiChat.modeAgent') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useAppModeStore } from '@/stores/appModeStore'

  const { t } = useI18n()
  const appModeStore = useAppModeStore()
</script>

<style scoped>
  /* 分段式切换外壳：圆角胶囊，半透明背景 + 细边框 */
  .mode-toggle-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--ui-radius-lg);
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-subtle);
    /* 每段等宽，保证滑动 thumb 定位稳定 */
    --segment-width: 78px;
  }

  /* 滑动高亮背景：绝对定位，通过 transform 水平移动到激活段 */
  .mode-toggle-thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: var(--segment-width);
    border-radius: calc(var(--ui-radius-lg) - 2px);
    background: var(--ui-accent);
    transition: transform var(--ui-transition-normal);
    z-index: 0;
  }

  /* Agent 模式时，thumb 右移一段宽度（含 gap） */
  .mode-toggle-thumb.is-agent {
    transform: translateX(calc(var(--segment-width) + 2px));
  }

  .mode-toggle-option {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: var(--segment-width);
    height: 26px;
    padding: 0 8px;
    border: none;
    background: transparent;
    border-radius: calc(var(--ui-radius-lg) - 2px);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: var(--ui-text-secondary);
    transition: color var(--ui-transition-fast);
    user-select: none;
  }

  .mode-toggle-option:hover:not(.active) {
    color: var(--ui-text-primary);
  }

  /* 激活段：白色文字（盖在 accent 色 thumb 之上） */
  .mode-toggle-option.active {
    color: var(--ui-text-on-accent);
  }

  .mode-toggle-label {
    line-height: 1;
  }

  @media (max-width: 768px) {
    .mode-toggle-wrapper {
      --segment-width: 64px;
    }
  }
</style>

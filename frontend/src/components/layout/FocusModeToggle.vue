<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<!--
  @file FocusModeToggle.vue
  @description 专注模式切换按钮（进入 / 退出一体）

  位于 tab-bar 右端的单个内联图标按钮（VS Code 式视图操作位）：
  - 非专注态：四角外扩（maximize 风格）图标，提示进入专注模式
  - 专注态：四角内收图标 + accent 高亮，提示退出专注模式

  直接绑定 focusModeStore（Pinia），无需走 eventBus——store 状态即真相源。
  布局快照的写入 / 恢复编排由 App.vue 的 watch 完成，本组件只翻转状态。
-->

<template>
  <button
    type="button"
    class="focus-mode-toggle"
    :class="{ 'is-active': focusModeStore.isFocusMode }"
    :title="tooltip"
    :aria-label="
      focusModeStore.isFocusMode ? t('aiChat.focusModeExit') : t('aiChat.focusModeEnter')
    "
    :aria-pressed="focusModeStore.isFocusMode"
    @click="focusModeStore.toggleFocus()"
  >
    <!-- 非专注态：四角外扩（maximize 风格），示意"展开为专注双栏" -->
    <svg
      v-if="!focusModeStore.isFocusMode"
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
      <polyline points="15 3 21 3 21 9"></polyline>
      <polyline points="9 21 3 21 3 15"></polyline>
      <line x1="21" y1="3" x2="14" y2="10"></line>
      <line x1="3" y1="21" x2="10" y2="14"></line>
    </svg>
    <!-- 专注态：四角内收，示意"收起回普通布局" -->
    <svg
      v-else
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
      <polyline points="4 14 10 14 10 20"></polyline>
      <polyline points="20 10 14 10 14 4"></polyline>
      <line x1="14" y1="10" x2="21" y2="3"></line>
      <line x1="3" y1="21" x2="10" y2="14"></line>
    </svg>
  </button>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useFocusModeStore } from '@/stores/focusModeStore'

  const { t } = useI18n()
  const focusModeStore = useFocusModeStore()

  /** 悬停提示：非专注态附带专注模式说明，专注态仅提示退出 */
  const tooltip = computed(() =>
    focusModeStore.isFocusMode
      ? t('aiChat.focusModeExit')
      : `${t('aiChat.focusModeEnter')} · ${t('aiChat.focusModeHint')}`
  )
</script>

<style scoped>
  .focus-mode-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 26px;
    min-width: 32px;
    padding: 0 8px;
    border: 1px solid var(--ui-border-subtle);
    border-radius: var(--ui-radius-lg);
    background: var(--ui-bg-elevated);
    cursor: pointer;
    color: var(--ui-text-secondary);
    transition:
      background var(--ui-transition-fast),
      color var(--ui-transition-fast);
    user-select: none;
  }

  .focus-mode-toggle:hover {
    background: var(--ui-bg-hover);
    color: var(--ui-text-primary);
  }

  /* 专注态：accent 高亮，与一级开关的语义一致 */
  .focus-mode-toggle.is-active {
    background: var(--ui-accent);
    border-color: transparent;
    color: var(--ui-text-on-accent);
  }
</style>

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
  @file CanvasControls.vue
  @description 画布左下角自定义操作按钮：聚焦项目 + 整理节点 + 视图模式切换 +
  仅异常开关 + 节点类型筛选下拉，与 Vue Flow Controls（缩放）并列显示。

  视图模式（全景/聚焦分段）与仅异常为独立开关，可叠加；类型筛选为勾选下拉。
  三者均由 graphStore 的 viewFilter 模块统一管理（只隐藏自己藏的节点）。
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

    <div class="control-separator"></div>

    <div class="view-mode-segment" :title="focusTitle">
      <button
        class="segment-btn"
        :class="{ active: store.viewFilterMode === 'panorama' }"
        :title="t('canvas.viewFilter.panorama')"
        :aria-pressed="store.viewFilterMode === 'panorama'"
        data-testid="view-mode-panorama"
        @click="store.setViewFilterMode('panorama')"
      >
        <span class="control-icon">&#x25CE;</span>
      </button>
      <button
        class="segment-btn"
        :class="{ active: store.viewFilterMode === 'focus' }"
        :title="t('canvas.viewFilter.focus')"
        :aria-pressed="store.viewFilterMode === 'focus'"
        data-testid="view-mode-focus"
        @click="store.setViewFilterMode('focus')"
      >
        <span class="control-icon">&#x25C9;</span>
      </button>
    </div>

    <button
      class="control-btn"
      :class="{ 'is-active': store.viewFilterErrorsOnly }"
      :title="t('canvas.viewFilter.errorsOnly')"
      :aria-pressed="store.viewFilterErrorsOnly"
      data-testid="view-mode-errors-only"
      @click="store.toggleViewFilterErrorsOnly"
    >
      <span class="control-icon">&#x26A0;</span>
    </button>

    <div ref="typeFilterWrap" class="type-filter-wrap">
      <button
        class="control-btn"
        :class="{ 'is-active': store.viewFilterHiddenGroups.size > 0 }"
        :title="t('canvas.viewFilter.typeFilter')"
        :aria-expanded="typeMenuOpen"
        data-testid="view-type-filter"
        @click="typeMenuOpen = !typeMenuOpen"
      >
        <span class="control-icon">&#x2630;</span>
      </button>
      <div v-if="typeMenuOpen" class="type-filter-menu">
        <button
          v-for="group in NODE_FILTER_GROUPS"
          :key="group"
          class="type-filter-item"
          type="button"
          @click="store.setViewFilterGroupHidden(group, !store.viewFilterHiddenGroups.has(group))"
        >
          <span
            class="type-filter-check"
            :class="{ checked: !store.viewFilterHiddenGroups.has(group) }"
          >
            {{ store.viewFilterHiddenGroups.has(group) ? '' : '&#x2713;' }}
          </span>
          <span>{{ t(`canvas.viewFilter.groups.${group}`) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useCanvasLifecycle } from '@/composables/canvas/useCanvasLifecycle'
  import { useNodeOrganizer } from '@/features/node-layout-organizer/composables/useNodeOrganizer'
  import { useGraphStore } from '@/stores/graphStore'
  import { NODE_FILTER_GROUPS } from '@/stores/graphStore/modules/viewFilter'

  const { t } = useI18n()
  const store = useGraphStore()
  const nodeOrganizer = useNodeOrganizer()
  const { focusToProjectRoot } = useCanvasLifecycle()

  const typeMenuOpen = ref(false)
  const typeFilterWrap = ref<HTMLElement | null>(null)

  const focusTitle = computed(() =>
    store.viewFilterMode === 'focus' && !store.viewFilterFocusAnchorId
      ? t('canvas.viewFilter.focusHint')
      : t('canvas.viewFilter.focus')
  )

  // 资源泄漏纪律：外点关闭菜单的监听与组件生命周期成对注册/清理
  function handlePointerDownOutside(event: PointerEvent) {
    if (!typeMenuOpen.value) return
    const el = typeFilterWrap.value
    if (el && event.target instanceof Node && !el.contains(event.target)) {
      typeMenuOpen.value = false
    }
  }

  onMounted(() => {
    window.addEventListener('pointerdown', handlePointerDownOutside)
  })

  onUnmounted(() => {
    window.removeEventListener('pointerdown', handlePointerDownOutside)
  })
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
    overflow: visible;
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

  .control-btn.is-active {
    background: var(--ui-bg-hover);
    color: var(--ui-accent, #4c6ef5);
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

  .view-mode-segment {
    display: flex;
    align-items: stretch;
  }

  .segment-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 32px;
    background: transparent;
    border: none;
    color: var(--ui-text-secondary, #868e96);
    font-size: 15px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .segment-btn:hover {
    background: var(--ui-bg-hover);
  }

  .segment-btn.active {
    background: var(--ui-bg-hover);
    color: var(--ui-accent, #4c6ef5);
  }

  .type-filter-wrap {
    position: relative;
    display: flex;
  }

  .type-filter-menu {
    position: absolute;
    bottom: 38px;
    left: 0;
    min-width: 132px;
    padding: 4px;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-md);
    box-shadow: var(--ui-shadow-elevation-md);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .type-filter-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    background: transparent;
    border: none;
    border-radius: var(--ui-radius-sm, 4px);
    color: var(--ui-text-primary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .type-filter-item:hover {
    background: var(--ui-bg-hover);
  }

  .type-filter-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: 1px solid var(--ui-border-light);
    border-radius: 3px;
    font-size: 11px;
    line-height: 1;
    color: var(--ui-accent, #4c6ef5);
  }

  .type-filter-check.checked {
    background: var(--ui-bg-hover);
  }
</style>

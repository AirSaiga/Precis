<!--
  @file MultiSelectToolbar.vue
  @description 批量操作工具栏组件

  显示当前选中的资源数量及批量操作按钮。
-->

<template>
  <div class="multi-select-toolbar">
    <span class="selected-count">
      {{
        t('assetLibraryExtended.projectView.multiSelect.selectedCount', { count: selectedCount })
      }}
    </span>
    <div class="toolbar-actions">
      <button class="toolbar-btn" @click="emit('batch-add')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        {{ t('assetLibraryExtended.projectView.multiSelect.addToCanvas') }}
      </button>
      <button class="toolbar-btn toolbar-btn-danger" @click="emit('batch-delete')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="3 6 5 6 21 6"></polyline>
          <path
            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
          ></path>
        </svg>
        {{ t('assetLibraryExtended.projectView.multiSelect.deleteSelected') }}
      </button>
      <button class="toolbar-btn toolbar-btn-ghost" @click="emit('clear-selection')">
        {{ t('assetLibraryExtended.projectView.multiSelect.clearSelection') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  interface Props {
    selectedCount: number
  }

  defineProps<Props>()

  const emit = defineEmits<{
    'batch-add': []
    'batch-delete': []
    'clear-selection': []
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./MultiSelectToolbar.styles.css"></style>

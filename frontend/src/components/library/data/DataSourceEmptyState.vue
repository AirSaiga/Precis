<!--
  @file DataSourceEmptyState.vue
  @description 数据源空状态组件

  功能概述:
  - 展示空状态插画和提示文本
  显示支持的文件类型标签
  - 支持点击触发导入

  Emits:
  - click-import: 点击导入事件
-->
<template>
  <div class="empty-state-container px-4">
    <div
      class="empty-drop-zone"
      :class="{ 'is-drag-over': isDragOver }"
      @click="$emit('click-import')"
    >
      <div class="empty-icon-box">
        <svg
          class="empty-illustration"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
          ></path>
        </svg>
      </div>
      <div class="empty-text-group">
        <p class="empty-desc">{{ t('assetLibraryExtended.dataView.dropZone.mainText') }}</p>
        <p class="empty-subtext">
          {{ t('assetLibraryExtended.dataView.dropZone.folderHint') }}
        </p>
      </div>
      <div class="support-types">
        <span>.xlsx</span>
        <span>.xls</span>
        <span>.csv</span>
        <span>.json</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  interface Props {
    isDragOver?: boolean
  }

  withDefaults(defineProps<Props>(), {
    isDragOver: false,
  })

  defineEmits<{
    'click-import': []
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./DataSourceEmptyState.styles.css"></style>

<!--
  @file DataSourceImportZone.vue
  @description 数据源导入拖拽区域组件

  功能概述:
  - 提供文件拖拽放置区域
  - 支持点击触发导入
  - 拖拽时显示视觉反馈

  Props:
  - isDragOver: 是否处于拖拽悬停状态

  Emits:
  - drop-file: 文件放置事件
  - click-import: 点击导入事件
-->
<template>
  <div class="import-section px-4">
    <div
      class="import-dropzone"
      :class="{ 'is-drag-over': isDragOver }"
      @dragover.prevent="$emit('drag-over', $event)"
      @drop.prevent="$emit('drop-file', $event)"
      @dragleave.prevent="$emit('drag-leave', $event)"
      @click="$emit('click-import')"
    >
      <svg
        class="dropzone-icon"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 4V16M12 4L8 8M12 4L16 8M4 20H20" />
      </svg>
      <span class="dropzone-text">{{ t('assetLibraryExtended.dataView.buttons.import') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  interface Props {
    isDragOver: boolean
  }

  defineProps<Props>()

  defineEmits<{
    'drag-over': [event: DragEvent]
    'drag-leave': [event: DragEvent]
    'drop-file': [event: DragEvent]
    'click-import': []
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./DataSourceImportZone.styles.css"></style>

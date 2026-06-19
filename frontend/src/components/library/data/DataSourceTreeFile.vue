<!--
  @file DataSourceTreeFile.vue
  @description 数据源树形文件节点组件

  功能概述:
  - 渲染文件节点：类型图标 + 文件信息 + 操作按钮
  - 支持拖拽到画布
  - 显示文件大小和添加日期

  Props:
  - dataSource: 外部数据源对象
  - isHover: 是否处于悬停状态
  - level: 嵌套层级

  Emits:
  - open: 打开文件
  - remove: 移除数据源
  - drag-start: 拖拽开始
  - hover: 悬停状态变化（传入数据源 ID 或 null）
-->
<template>
  <div
    class="file-item-pro"
    :class="{
      uploading: dataSource.status === 'loading',
      error: dataSource.status === 'error',
      ready: dataSource.status === 'ready',
      active: isHover,
    }"
    :style="{ paddingLeft: level * 16 + 8 + 'px' }"
    draggable="true"
    @dragstart="$emit('drag-start', $event)"
    @dragend="$emit('drag-end')"
    @mouseenter="$emit('hover', dataSource.id)"
    @mouseleave="$emit('hover', null)"
  >
    <div class="file-icon-wrapper" :class="dataSource.type">
      <svg
        v-if="dataSource.type === 'excel'"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
      <svg
        v-else-if="dataSource.type === 'csv'"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="8" y1="13" x2="16" y2="13"></line>
        <line x1="8" y1="17" x2="12" y2="17"></line>
      </svg>
      <svg
        v-else-if="dataSource.type === 'json'"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <path d="M10 13l-2 2 2 2"></path>
        <path d="M14 13l2 2-2 2"></path>
      </svg>
    </div>

    <div class="file-info">
      <div class="file-name" :title="dataSource.name">
        {{ dataSource.name }}
      </div>
      <div class="file-meta">
        <span class="meta-tag size" v-if="getFileSize(dataSource)">
          {{ formatFileSize(getFileSize(dataSource)!) }}
        </span>
        <span class="meta-divider" v-if="getFileSize(dataSource)">·</span>
        <span class="meta-tag date">{{ formatDate(dataSource.addedAt) }}</span>
      </div>
    </div>

    <div class="file-actions">
      <transition name="fade" mode="out-in">
        <div class="action-group" v-if="isHover || dataSource.status === 'loading'">
          <button
            v-if="shellApi.canOpenLocalFile && dataSource.sourceMode === 'localfile'"
            class="icon-btn open-btn"
            @click.stop="$emit('open')"
            :title="t('assetLibraryExtended.dataView.buttons.open')"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
          <button
            class="icon-btn remove-btn"
            @click.stop="$emit('remove')"
            :title="t('assetLibraryExtended.dataView.buttons.remove')"
            :disabled="dataSource.status === 'loading'"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { shellApi } from '@/core/capabilities/shellApi'
  import type { ExternalDataSource } from '@/types/graph'

  interface Props {
    dataSource: ExternalDataSource
    isHover: boolean
    level: number
  }

  defineProps<Props>()

  defineEmits<{
    open: []
    remove: []
    'drag-start': [event: DragEvent]
    'drag-end': []
    hover: [dataSourceId: string | null]
  }>()

  const { t } = useI18n()

  /**
   * 获取数据源文件大小
   */
  const getFileSize = (dataSource: ExternalDataSource): number | null => {
    if (dataSource.size !== undefined && dataSource.size !== null) {
      return dataSource.size
    }
    return null
  }

  /**
   * 格式化文件大小显示
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * 格式化日期显示
   */
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
</script>

<style scoped src="./DataSourceTreeFile.styles.css"></style>

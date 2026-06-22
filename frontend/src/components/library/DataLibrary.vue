<!--
  @file DataLibrary.vue
  @description 数据资产库面板，展示可拖拽的数据源资产

  功能概述:
  - 管理外部数据源（Excel/CSV/JSON）的导入、存储和删除
  - 提供文件拖拽和点击导入功能
  - 支持数据源列表的树形展示和状态管理
  - 处理数据源的拖拽操作，供画布节点使用
  - 支持文件夹扫描和批量导入

  Props：
  - 无

  Emits：
  - dragstart: 数据源开始拖拽时触发
  - dragend: 拖拽结束时触发
-->
<template>
  <div class="data-library">
    <!-- 数据源视图头部 -->
    <div class="data-view-header">
      <div class="header-content-wrapper">
        <div class="header-title-section">
          <h2>{{ t('assetLibraryExtended.dataView.title') }}</h2>
          <span v-if="workspaceStore.dataSources.length > 0" class="data-source-count">
            {{ workspaceStore.dataSources.length }}
          </span>
        </div>
        <button
          class="trash-button"
          @click="handleClearAll"
          :disabled="workspaceStore.dataSources.length === 0"
          :title="t('assetLibraryExtended.dataView.buttons.clear')"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M19 7L18.1327 19.1425C18.0579 20.1891 17.187 21 16.1378 21H7.86224C6.81296 21 5.94208 20.1891 5.86732 19.1425L5 7M10 11V17M14 11V17M15 7V4C15 3.44772 14.5523 3 14 3H10C9.44772 3 9 3.44772 9 4V7M4 7H20"
            />
          </svg>
        </button>
      </div>
    </div>

    <!-- 导入区域 -->
    <DataSourceImportZone
      :is-drag-over="isDragOver"
      @drag-over="handleDragOver"
      @drag-leave="handleDragLeave"
      @drop-file="handleExternalFileDrop"
      @click-import="handleImportFiles"
    />

    <!-- 数据源区域 -->
    <div class="data-sources-section-new px-4">
      <DataSourceTree
        v-if="workspaceStore.dataSources && workspaceStore.dataSources.length > 0"
        :tree-data="dataSourcesTree"
        :item-hover="itemHover"
        @toggle-folder="toggleFolder"
        @hover-item="itemHover = $event"
        @drag-start="handleDataSourceDragStart"
        @drag-end="handleDragEnd"
        @remove="handleRemoveDataSource"
        @open="handleOpenDataSource"
      />
      <DataSourceEmptyState v-else :is-drag-over="isDragOver" @click-import="handleImportFiles" />
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useWorkspaceStore } from '@/stores/workspaceStore'
  import { logger } from '@/core/utils/logger'
  import { useDataSourceTree } from '@/composables/data/useDataSourceTree'
  import { useDataSourceImport } from '@/composables/data/useDataSourceImport'
  import { useDataSourceDrag } from '@/composables/data/useDataSourceDrag'
  import { useDataSourceFileOps } from '@/composables/data/useDataSourceFileOps'
  interface DataSourceDragPayload {
    type: string
    source: string
    fileId: string
    fileName: string
    name: string
    fileType: string
    sourceId: string
    label: string
    sourceMode: string
    localPath?: string
  }
  import DataSourceImportZone from './data/DataSourceImportZone.vue'
  import DataSourceTree from './data/DataSourceTree.vue'
  import DataSourceEmptyState from './data/DataSourceEmptyState.vue'

  /**
   * i18n 国际化实例
   */
  const { t } = useI18n()

  /**
   * 工作区状态管理 Store
   */
  const workspaceStore = useWorkspaceStore()

  // 初始化数据源
  const dataSourceArray = workspaceStore.getDataSources()
  logger.debug('[DataLibrary] 组件初始化，workspaceStore:', workspaceStore)
  logger.debug('[DataLibrary] 当前数据源数量:', dataSourceArray.length)
  logger.debug('[DataLibrary] 数据源详情:', JSON.stringify(dataSourceArray, null, 2))

  /**
   * 组件事件定义
   */
  const emit = defineEmits<{
    dragstart: [payload: DataSourceDragPayload]
    dragend: []
  }>()

  /**
   * 树形结构相关
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const { collapsedFolders, dataSourcesTree, toggleFolder } = useDataSourceTree()

  /**
   * 导入相关
   */
  const {
    isDragOver,
    handleDragOver,
    handleDragLeave,
    handleExternalFileDrop,
    handleImportFiles,
    handleReloadFileUploaded,
  } = useDataSourceImport()

  /**
   * 拖拽相关
   */
  const { handleDataSourceDragStart, handleDragEnd } = useDataSourceDrag(emit)

  /**
   * 文件操作相关
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 当前未使用，保留以支持后续扩展或模板使用
  const { handleOpenDataSource, handleReselectFile, handleClearAll, handleRemoveDataSource } =
    useDataSourceFileOps()

  /**
   * 当前悬停的数据源 ID
   */
  const itemHover = ref<string | null>(null)

  /**
   * 组件挂载生命周期钩子
   */
  onMounted(async () => {
    logger.debug('[DataLibrary] 组件挂载，开始加载数据源')
    try {
      await workspaceStore.loadConfig()
      logger.debug('[DataLibrary] 数据源加载完成')
    } catch (error) {
      logger.error('[DataLibrary] 数据源加载失败:', error)
    }

    // 监听重新加载文件事件
    document.addEventListener(
      'reload-file-uploaded',
      handleReloadFileUploaded as unknown as EventListener
    )
  })

  /**
   * 组件卸载生命周期钩子
   */
  onUnmounted(() => {
    document.removeEventListener(
      'reload-file-uploaded',
      handleReloadFileUploaded as unknown as EventListener
    )
  })

  /**
   * 监听数据源状态变化
   */
  workspaceStore.$subscribe((mutation, state) => {
    logger.debug('[DataLibrary] 数据源状态变化:', {
      dataSourcesLength: state.config.recent_data_sources?.length || 0,
      dataSources: state.config.recent_data_sources || [],
    })
  })

  /**
   * 暴露给父组件的方法和属性
   */
  defineExpose({
    workspaceStore,
  })
</script>

<style scoped src="./DataLibrary.styles.css"></style>

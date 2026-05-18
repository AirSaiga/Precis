<!--
  @file JsonSchemaNodeDataSourceDropdown.vue
  @description JSON Schema 数据源下拉选择

  功能概述：
  - 以树状结构显示外部数据源栏的 JSON 数据
  - 支持选择数据源并创建连接
  - 支持文件夹展开/折叠

  Props：
  - show: boolean — 是否显示下拉菜单
  - position: { top: number; left: number } — 菜单位置
  - currentSource: object | null — 当前选中的数据源
  - dataSourceTree: DataSourceTreeItem[] — 数据源树状列表

  Emits：
  - select: 选择数据源
  - close: 关闭下拉菜单
-->
<template>
  <Teleport to="body">
    <template v-if="props.show">
      <div class="dropdown-backdrop" @click="emit('close')"></div>
      <div
        class="source-dropdown-menu fixed-dropdown"
        :style="{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }"
        @click.stop
      >
        <!-- 当前连接 -->
        <div class="dropdown-header">
          <span class="header-title">{{
            t('customNodes.jsonSchemaNode.source.currentConnection')
          }}</span>
        </div>

        <div
          v-if="currentSource?.sourceName"
          class="dropdown-item current-connection"
          :title="currentSource.sourceName"
        >
          <span class="item-icon">📄</span>
          <div class="item-content">
            <div class="item-title">{{ currentSource.sourceName }}</div>
          </div>
        </div>

        <div v-else class="dropdown-item disabled">
          <span class="item-icon">🚫</span>
          <div class="item-content">
            <div class="item-title">{{ t('customNodes.jsonSchemaNode.source.noSource') }}</div>
          </div>
        </div>

        <div class="dropdown-divider"></div>

        <!-- 可用数据源树状列表 -->
        <div class="dropdown-header">
          <span class="header-title">{{
            t('customNodes.jsonSchemaNode.source.availableSources')
          }}</span>
        </div>

        <div class="tree-container">
          <template v-for="item in dataSourceTree" :key="item.id">
            <!-- 文件夹节点 -->
            <div
              v-if="item.type === 'folder'"
              class="tree-folder"
              :style="{ paddingLeft: `${item.level * 16 + 12}px` }"
              @click="toggleFolder(item.folderPath || '')"
            >
              <span
                class="folder-toggle-icon"
                :class="{ 'is-collapsed': isFolderCollapsed(item.folderPath || '') }"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
              <span class="folder-icon">📁</span>
              <span class="folder-name">{{ item.name }}</span>
            </div>

            <!-- 文件节点 -->
            <div
              v-else-if="item.type === 'file' && item.dataSource && shouldShowFile(item)"
              class="tree-file"
              :class="{ 'is-current': isCurrentSource(item.dataSource) }"
              :style="{ paddingLeft: `${item.level * 16 + 12}px` }"
              @click="handleSelect(item.dataSource)"
              :title="item.dataSource.name"
            >
              <span class="file-icon">📄</span>
              <span class="file-name">{{ item.dataSource.name }}</span>
            </div>
          </template>
        </div>

        <div v-if="dataSourceTree.length === 0" class="dropdown-item disabled">
          <span class="item-icon">🚫</span>
          <div class="item-content">
            <div class="item-title">{{ t('customNodes.jsonSchemaNode.source.noAvailable') }}</div>
            <div class="item-subtitle">
              {{ t('customNodes.jsonSchemaNode.source.importFirst') }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<script setup lang="ts">
  /**
   * @file JsonSchemaNodeDataSourceDropdown.vue
   * @description JSON Schema节点数据源下拉选择组件
   *
   * 核心功能：
   * - 以树状结构显示外部数据源栏的 JSON 数据
   * - 支持选择数据源并自动创建 JsonSourcePreview 节点
   * - 支持切换数据源时断开旧连接、智能填充列定义
   *
   * 数据流：
   * 外部数据源栏 → 树状结构 → 下拉菜单 → JSON Schema节点数据源绑定/切换
   *
   * JSON Schema 特有功能：
   * - 支持 JSON/JSON Lines 文件类型
   * - 支持嵌套结构的展开/折叠
   */

  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { ExternalDataSource } from '@/types/datasource'

  /**
   * 树状数据源项接口
   */
  export interface DataSourceTreeItem {
    type: 'folder' | 'file'
    id: string
    name: string
    folderPath?: string
    dataSource?: ExternalDataSource
    level: number
  }

  /**
   * 组件属性
   */
  const props = defineProps<{
    show: boolean
    position: { top: number; left: number }
    currentSource: { id?: string; sourceName?: string } | null
    dataSourceTree: DataSourceTreeItem[]
  }>()

  /**
   * 组件事件
   */
  const emit = defineEmits<{
    (e: 'select', dataSource: ExternalDataSource): void
    (e: 'close'): void
  }>()

  const { t } = useI18n()

  /**
   * 折叠的文件夹集合
   */
  const collapsedFolders = ref<Set<string>>(new Set())

  /**
   * 检查文件夹是否折叠
   */
  const isFolderCollapsed = (folderPath: string): boolean => {
    return collapsedFolders.value.has(folderPath)
  }

  /**
   * 切换文件夹展开/折叠状态
   */
  const toggleFolder = (folderPath: string): void => {
    const newSet = new Set(collapsedFolders.value)
    if (newSet.has(folderPath)) {
      newSet.delete(folderPath)
    } else {
      newSet.add(folderPath)
    }
    collapsedFolders.value = newSet
  }

  /**
   * 检查文件是否应该显示（其父文件夹未折叠）
   */
  const shouldShowFile = (fileItem: DataSourceTreeItem): boolean => {
    if (!fileItem.folderPath) {
      return true
    }

    const parts = fileItem.folderPath.split(/[/\\]/)
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
      if (i < parts.length - 1 || fileItem.folderPath === currentPath) {
        if (collapsedFolders.value.has(currentPath)) {
          return false
        }
      }
    }

    return true
  }

  /**
   * 检查数据源是否为当前选中的源
   */
  const isCurrentSource = (dataSource: ExternalDataSource): boolean => {
    if (props.currentSource?.id && props.currentSource.id === dataSource.id) return true
    if (!props.currentSource?.sourceName) return false
    return [dataSource.localPath, dataSource.name].some(
      (value) => value === props.currentSource?.sourceName
    )
  }

  /**
   * 选择数据源处理函数
   * @param dataSource - 选择的数据源
   */
  const handleSelect = (dataSource: ExternalDataSource): void => {
    if (isCurrentSource(dataSource)) {
      emit('close')
      return
    }
    emit('select', dataSource)
  }
</script>

<style scoped src="./JsonSchemaNodeDataSourceDropdown.styles.css"></style>

<!--
  @file DataSourceTree.vue
  @description 数据源树形列表组件

  功能概述:
  - 使用 TransitionGroup 渲染文件夹和文件节点
  - 支持文件夹展开/折叠和文件悬停状态
  - 转发拖拽、打开、移除等事件

  Props:
  - treeData: 扁平化的树节点数组
  - itemHover: 当前悬停的数据源 ID

  Emits:
  - toggle-folder: 切换文件夹展开/折叠
  - hover-item: 悬停状态变化
  - drag-start: 文件拖拽开始
  - remove: 移除数据源
  - open: 打开数据源文件
-->

<template>
  <div class="data-sources-list-new custom-scrollbar space-y-1">
    <transition-group name="list">
      <template v-for="item in treeData" :key="item.id">
        <DataSourceTreeFolder
          v-if="item.type === 'folder'"
          :folder="item"
          :is-collapsed="!item.isExpanded"
          :level="item.level"
          @toggle="$emit('toggle-folder', item.folderPath || '')"
        />
        <DataSourceTreeFile
          v-else-if="item.type === 'file' && item.dataSource"
          :data-source="item.dataSource"
          :is-hover="itemHover === item.dataSource.id"
          :level="item.level"
          @open="$emit('open', item.dataSource)"
          @remove="$emit('remove', item.dataSource.id)"
          @drag-start="$emit('drag-start', $event, item.dataSource)"
          @drag-end="$emit('drag-end')"
          @hover="$emit('hover-item', $event)"
        />
      </template>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
  import DataSourceTreeFolder from './DataSourceTreeFolder.vue'
  import DataSourceTreeFile from './DataSourceTreeFile.vue'
  import type { TreeNodeItem } from '@/composables/data/useDataSourceTree'
  import type { ExternalDataSource } from '@/types/graph'

  interface Props {
    treeData: TreeNodeItem[]
    itemHover: string | null
  }

  defineProps<Props>()

  defineEmits<{
    'toggle-folder': [folderPath: string]
    'hover-item': [dataSourceId: string | null]
    'drag-start': [event: DragEvent, dataSource: ExternalDataSource]
    'drag-end': []
    remove: [dataSourceId: string]
    open: [dataSource: ExternalDataSource]
  }>()
</script>

<style scoped src="./DataSourceTree.styles.css"></style>

<style>
  /* TransitionGroup 动画类（非 scoped，作用于子组件根元素） */
  .list-enter-active,
  .list-leave-active {
    transition: all 0.2s ease;
  }
  .list-enter-from,
  .list-leave-to {
    opacity: 0;
    transform: translateX(-10px);
  }
</style>

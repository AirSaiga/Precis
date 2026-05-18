<!--
  @file DataSourceTreeFolder.vue
  @description 数据源树形文件夹节点组件

  功能概述:
  - 渲染文件夹节点：展开/折叠图标 + 文件夹图标 + 名称
  - 支持点击切换展开/折叠状态

  Props:
  - folder: 文件夹节点数据
  - isCollapsed: 是否折叠
  - level: 嵌套层级

  Emits:
  - toggle: 切换展开/折叠
-->
<template>
  <div
    class="folder-item"
    :class="{ 'folder-expanded': !isCollapsed }"
    :style="{ paddingLeft: level * 16 + 8 + 'px' }"
    @click="$emit('toggle')"
  >
    <div class="folder-toggle">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        :class="{ 'rotate-90': !isCollapsed }"
      >
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </div>
    <div class="folder-icon">
      <svg
        width="18"
        height="18"
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
    <span class="folder-name">{{ folder.name }}</span>
  </div>
</template>

<script setup lang="ts">
  import type { TreeNodeItem } from '@/composables/data/useDataSourceTree'

  interface Props {
    folder: TreeNodeItem
    isCollapsed: boolean
    level: number
  }

  defineProps<Props>()

  defineEmits<{
    toggle: []
  }>()
</script>

<style scoped src="./DataSourceTreeFolder.styles.css"></style>

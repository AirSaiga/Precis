<!--
  @file AssetLibrary.vue
  @description 资产库布局容器

  作为左侧侧边栏的资产库容器，根据当前视图动态切换显示：
  - project 视图：显示 ProjectLibrary（项目工具箱和资源浏览器）
  - data 视图：显示 DataLibrary（数据源管理）

  负责转发拖拽事件（dragstart / dragend）到父组件。
-->

<template>
  <div class="asset-library">
    <!-- 根据currentView动态显示不同内容 -->
    <!-- 视图-A：工程构建 (Project View) -->
    <ProjectLibrary
      v-if="currentView === 'project'"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
    />

    <!-- 视图-B：数据源 (Data View) -->
    <DataLibrary
      v-else-if="currentView === 'data'"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
    />
  </div>
</template>

<script setup lang="ts">
  import ProjectLibrary from '../library/ProjectLibrary.vue'
  import DataLibrary from '../library/DataLibrary.vue'

  // 定义组件的事件
  const emit = defineEmits<{
    dragstart: [payload: any]
    dragend: []
  }>()

  // 定义Props
  const props = defineProps<{
    currentView: 'project' | 'data'
  }>()

  // 处理子组件的拖拽事件
  const handleDragStart = (payload: any) => {
    emit('dragstart', payload)
  }

  const handleDragEnd = () => {
    emit('dragend')
  }
</script>

<style scoped src="./AssetLibrary.styles.css"></style>

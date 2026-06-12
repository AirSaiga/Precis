<!--
  @file AssetLibrary.vue
  @description 资产库布局容器

  作为左侧侧边栏的资产库容器，根据当前视图动态切换显示：
  - toolbox 视图：显示工具箱（可拖拽组件磁贴）
  - resources 视图：显示项目资源浏览器
  - ai-chat 视图：显示 AI 对话面板
  - validation-history 视图：显示校验历史面板
  - data 视图：显示数据源管理

  负责转发拖拽事件（dragstart / dragend）到父组件。
-->

<template>
  <div class="asset-library">
    <!-- 工具箱 / 项目资源视图 -->
    <ProjectLibrary
      v-show="currentView === 'toolbox' || currentView === 'resources'"
      :view="currentView === 'toolbox' || currentView === 'resources' ? currentView : 'toolbox'"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
    />

    <!-- AI 助手视图 -->
    <AIChatPanel v-show="currentView === 'ai-chat'" />

    <!-- 校验历史视图 -->
    <ValidationHistoryPanel v-show="currentView === 'validation-history'" />

    <!-- 数据源视图 -->
    <DataLibrary
      v-show="currentView === 'data'"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
    />
  </div>
</template>

<script setup lang="ts">
  import { defineAsyncComponent } from 'vue'
  import ProjectLibrary from '../library/ProjectLibrary.vue'
  import DataLibrary from '../library/DataLibrary.vue'

  const AIChatPanel = defineAsyncComponent(() => import('../ai/AIChatPanel.vue'))
  const ValidationHistoryPanel = defineAsyncComponent(
    () => import('../validationHistory/ValidationHistoryPanel.vue')
  )

  // 定义组件的事件
  const emit = defineEmits<{
    dragstart: [payload: any]
    dragend: []
  }>()

  // 定义Props
  const props = defineProps<{
    currentView: 'toolbox' | 'resources' | 'ai-chat' | 'validation-history' | 'data'
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

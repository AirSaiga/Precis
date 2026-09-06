<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
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

  import type { ResourceDragPayload } from '@/stores/resourceDragStore'
  const emit = defineEmits<{
    dragstart: [payload: ResourceDragPayload]
    dragend: []
  }>()

  // 定义Props
  interface Props {
    currentView: 'toolbox' | 'resources' | 'ai-chat' | 'validation-history' | 'data'
  }

  defineProps<Props>()

  // 处理子组件的拖拽事件
  const handleDragStart = (payload: unknown) => {
    emit('dragstart', payload as unknown as ResourceDragPayload)
  }

  const handleDragEnd = () => {
    emit('dragend')
  }
</script>

<style scoped src="./AssetLibrary.styles.css"></style>

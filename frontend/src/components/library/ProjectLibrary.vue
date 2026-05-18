<!--
  @file ProjectLibrary.vue
  @description 项目库组件

  提供项目级工具箱和资源浏览器功能：
  - 工具箱（Toolbox）：可拖拽的组件磁贴（Schema、Regex、Constraint、TableSet 等）
  - 资源浏览器（Resources）：展示项目资产树（Schema、Constraint、Regex、Pattern）

  支持拖拽创建节点到画布，以及资源项的展开/折叠。
-->

<template>
  <div class="project-library">
    <!-- 顶部标签页导航 -->
    <div class="library-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'toolbox' }"
        @click="switchTab('toolbox')"
      >
        {{ t('assetLibraryExtended.projectView.toolbox.title') }}
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'resources' }"
        @click="switchTab('resources')"
      >
        {{ t('assetLibraryExtended.projectView.explorer.title') }}
      </button>
    </div>

    <!-- 视图 A: 工具箱 (Toolbox) -->
    <ToolboxPanel
      v-show="activeTab === 'toolbox'"
      @dragstart="emit('dragstart', $event)"
      @dragend="emit('dragend')"
    />

    <!-- 视图 B: 资源树 (Resources) -->
    <ResourceExplorerPanel
      v-show="activeTab === 'resources'"
      v-model:searchQuery="searchQuery"
      :filtered-folders="filteredFolders"
      :has-selection="hasSelection"
      :selected-count="selectedResources.size"
      :is-multi-select-mode="isMultiSelectMode"
      :selected-ids="selectedResources"
      :expanded-schemas="expandedSchemas"
      @batch-add="handleBatchAddToCanvas"
      @batch-delete="handleBatchDelete"
      @clear-selection="clearSelection"
      @toggle-folder="toggleFolder"
      @toggle-schema-expand="toggleSchemaExpand"
      @toggle-select="toggleSelect"
      @resource-select="handleResourceSelect"
      @resource-mousedown="handleResourceMouseDown"
      @resource-mouseup="handleResourceMouseUp"
      @resource-mouseleave="handleResourceMouseLeave"
      @resource-dragstart="handleResourceDragStartWrapper"
      @dragend="handleDragEnd"
      @contextmenu="openContextMenu"
      @project-config-dragstart="handleProjectConfigDragStart"
      @embedded-constraint-click="handleEmbeddedConstraintClick"
    />

    <ResourceContextMenu />
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { logger } from '@/core/utils/logger'
  import ToolboxPanel from './ToolboxPanel.vue'
  import ResourceExplorerPanel from './ResourceExplorerPanel.vue'
  import ResourceContextMenu from '../resource/ResourceContextMenu.vue'
  import { useResourceTree, useResourceDrag, useResourceInteraction } from '@/composables/resource'
  import type { ResourceItem, SchemaResource } from '@/types/resource'

  const { t } = useI18n()

  const activeTab = ref<'toolbox' | 'resources'>('toolbox')

  const switchTab = (tab: 'toolbox' | 'resources') => {
    activeTab.value = tab
  }

  const {
    searchQuery,
    filteredFolders,
    toggleFolder,
    setSearchQuery,
    selectedResources,
    selectedResourceList,
    hasSelection,
    isMultiSelectMode,
    toggleSelect,
    clearSelection,
    batchAddToCanvas,
    batchDelete,
  } = useResourceTree()

  const { handleResourceDragStart, handleProjectConfigDragStart, handleDragEnd } = useResourceDrag()

  const {
    handleResourceMouseDown,
    handleResourceMouseUp,
    handleResourceMouseLeave,
    clearLongPressTimer,
    handleResourceClick,
  } = useResourceInteraction()

  // Schema 展开状态管理（使用 ref + 重新赋值确保响应式）
  const expandedSchemas = ref<Set<string>>(new Set())
  const toggleSchemaExpand = (schemaId: string) => {
    const newSet = new Set(expandedSchemas.value)
    if (newSet.has(schemaId)) {
      newSet.delete(schemaId)
    } else {
      newSet.add(schemaId)
    }
    expandedSchemas.value = newSet
  }

  watch(searchQuery, (newQuery) => {
    setSearchQuery(newQuery)
  })

  const handleResourceSelect = (resource: ResourceItem, event: MouseEvent): void => {
    handleResourceClick(resource, event, {
      onToggleExpand: () => {
        if (resource.kind === 'schema') {
          toggleSchemaExpand(resource.id)
        }
      },
    })
  }

  const handleResourceDragStartWrapper = (event: DragEvent, resource: ResourceItem): void => {
    clearLongPressTimer()
    handleResourceDragStart(event, resource)
  }

  const handleBatchAddToCanvas = async (): Promise<void> => {
    await batchAddToCanvas(selectedResourceList.value)
  }

  const handleBatchDelete = async (): Promise<void> => {
    await batchDelete(selectedResourceList.value)
  }

  const handleEmbeddedConstraintClick = (schema: ResourceItem, embeddedConstraint: unknown) => {
    logger.debug('内嵌约束点击:', schema.name, (embeddedConstraint as { name?: string }).name)
    alert(t('assetLibraryExtended.projectView.cannotDragEmbeddedConstraint'))
  }

  const openContextMenu = (
    event: MouseEvent,
    kind: 'schema' | 'pattern' | 'constraint' | 'regex_node',
    item: ResourceItem
  ) => {
    const contextMenuEl = document.querySelector('.resource-context-menu')
    if (contextMenuEl) {
      return
    }

    const payload = {
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      kind,
      item,
    }

    window.dispatchEvent(new CustomEvent('open-resource-context-menu', { detail: payload }))
  }

  const emit = defineEmits<{
    dragstart: [payload: { type: string; source: string; meta?: Record<string, unknown> }]
    dragend: []
  }>()

  defineExpose({
    searchQuery,
    expandedFolders: filteredFolders,
    loadProjectResources: () => {},
  })
</script>

<style scoped src="./ProjectLibrary.styles.css"></style>

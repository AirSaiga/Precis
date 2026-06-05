<!--
  @file ResourceExplorerPanel.vue
  @description 资源浏览器面板组件

  组合批量操作工具栏、搜索框和资源树主体。
-->

<template>
  <div class="tab-content resources-content">
    <!-- 批量操作工具栏 -->
    <MultiSelectToolbar
      v-if="hasSelection"
      :selected-count="selectedCount"
      @batch-add="emit('batch-add')"
      @batch-delete="emit('batch-delete')"
      @clear-selection="emit('clear-selection')"
    />

    <!-- 搜索框 -->
    <div class="search-container">
      <input
        v-model="localSearchQuery"
        type="text"
        class="search-input"
        :placeholder="t('assetLibraryExtended.projectView.explorer.filterAssets')"
      />
      <span class="search-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </span>
    </div>

    <!-- 资源树主体 -->
    <div class="explorer-section">
      <ResourceTree
        :filtered-folders="filteredFolders"
        :expanded-schemas="expandedSchemas"
        :is-multi-select-mode="isMultiSelectMode"
        :selected-ids="selectedIds"
        @toggle-folder="(id) => emit('toggle-folder', id)"
        @toggle-schema-expand="(id) => emit('toggle-schema-expand', id)"
        @toggle-select="(r) => emit('toggle-select', r)"
        @resource-select="(r, e) => emit('resource-select', r, e)"
        @resource-mousedown="(r) => emit('resource-mousedown', r)"
        @resource-mouseup="emit('resource-mouseup')"
        @resource-mouseleave="emit('resource-mouseleave')"
        @resource-dragstart="(e, r) => emit('resource-dragstart', e, r)"
        @dragend="emit('dragend')"
        @contextmenu="(e, k, r) => emit('contextmenu', e, k, r)"
        @project-config-dragstart="(e) => emit('project-config-dragstart', e)"
        @embedded-constraint-click="(s, ec) => emit('embedded-constraint-click', s, ec)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import MultiSelectToolbar from './MultiSelectToolbar.vue'
  import ResourceTree from './ResourceTree.vue'
  import type { ResourceFolder, ResourceFolderMap, ResourceItem } from '@/types/resource'

  interface Props {
    filteredFolders: ResourceFolderMap
    searchQuery: string
    hasSelection: boolean
    selectedCount: number
    isMultiSelectMode: boolean
    selectedIds: Set<string>
    expandedSchemas: Set<string>
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'update:searchQuery': [query: string]
    'batch-add': []
    'batch-delete': []
    'clear-selection': []
    'toggle-folder': [folderId: string]
    'toggle-schema-expand': [schemaId: string]
    'toggle-select': [resource: ResourceItem]
    'resource-select': [resource: ResourceItem, event: MouseEvent]
    'resource-mousedown': [resource: ResourceItem]
    'resource-mouseup': []
    'resource-mouseleave': []
    'resource-dragstart': [event: DragEvent, resource: ResourceItem]
    dragend: []
    contextmenu: [
      event: MouseEvent,
      kind: 'schema' | 'pattern' | 'constraint' | 'regex_node' | 'template',
      resource: ResourceItem,
    ]
    'project-config-dragstart': [event: DragEvent]
    'embedded-constraint-click': [schema: ResourceItem, ec: unknown]

  }>()

  const { t } = useI18n()

  const localSearchQuery = ref(props.searchQuery)

  watch(localSearchQuery, (newQuery) => {
    emit('update:searchQuery', newQuery)
  })

  watch(
    () => props.searchQuery,
    (newQuery) => {
      if (newQuery !== localSearchQuery.value) {
        localSearchQuery.value = newQuery
      }
    }
  )
</script>

<style scoped src="./ResourceExplorerPanel.styles.css"></style>

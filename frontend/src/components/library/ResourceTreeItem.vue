<!--
  @file ResourceTreeItem.vue
  @description 资源树单个资源项组件

  提供资源项的拖拽、选中状态、右键菜单和画布指示器。
-->

<template>
  <div
    class="tree-row file-row"
    :class="{ selected: isMultiSelectMode && isSelected }"
    draggable="true"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
    @contextmenu.prevent="emit('contextmenu', $event)"
    @click="emit('select', $event)"
    @mousedown="emit('mousedown')"
    @mouseup="emit('mouseup')"
    @mouseleave="emit('mouseleave')"
  >
    <!-- 展开/折叠箭头（仅 Schema 有内嵌约束时显示） -->
    <span v-if="hasExpandIcon" class="expand-icon-wrapper" @click.stop="emit('toggle')">
      <svg
        class="expand-icon"
        :class="{ expanded: isExpanded }"
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    </span>
    <!-- 占位符以保持对齐 -->
    <span v-else class="expand-icon-placeholder"></span>

    <!-- 多选复选框 -->
    <span v-if="isMultiSelectMode" class="select-checkbox" @click.stop="emit('toggle-select')">
      <svg
        v-if="isSelected"
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      </svg>
    </span>

    <!-- 文件图标（根据资源类型变化） -->
    <svg
      v-if="item.kind === 'schema'"
      class="file-icon"
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>
    <svg
      v-else-if="item.kind === 'constraint'"
      class="file-icon"
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
    </svg>
    <svg
      v-else-if="item.kind === 'pattern'"
      class="file-icon"
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
      <polyline points="16 18 22 12 16 6"></polyline>
      <polyline points="8 6 2 12 8 18"></polyline>
    </svg>
    <svg
      v-else-if="item.kind === 'regex_node'"
      class="file-icon"
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
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    </svg>
    <svg
      v-else
      class="file-icon"
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
    </svg>

    <!-- 资源名称 -->
    <span class="file-name">{{ item.name }}</span>

    <!-- Manifest 未列入标签 -->
    <span
      v-if="isUnlisted"
      class="manifest-tag"
      :title="t('assetLibraryExtended.projectView.explorer.unlistedInManifestTip')"
    >
      {{ t('assetLibraryExtended.projectView.explorer.unlistedInManifest') }}
    </span>

    <!-- Schema 解析错误标签 -->
    <span v-if="parseError" class="parse-error-tag" :title="parseError">
      {{ t('assetLibraryExtended.projectView.explorer.schemaParseError') }}
    </span>

    <!-- 画布指示器 -->
    <span
      v-if="isOnCanvas"
      class="canvas-indicator"
      :title="t('assetLibraryExtended.projectView.onCanvas')"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
    </span>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { ResourceItem } from '@/types/resource'

  interface Props {
    item: ResourceItem
    isSelected: boolean
    isMultiSelectMode: boolean
    isExpanded?: boolean
    hasEmbeddedConstraints?: boolean
    isOnCanvas?: boolean
    isUnlisted?: boolean
    parseError?: string | null
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    toggle: []
    'toggle-select': []
    select: [event: MouseEvent]
    dragstart: [event: DragEvent]
    dragend: []
    contextmenu: [event: MouseEvent]
    mousedown: []
    mouseup: []
    mouseleave: []
  }>()

  const { t } = useI18n()

  const hasExpandIcon = computed(() => {
    return props.item.kind === 'schema' && props.hasEmbeddedConstraints
  })
</script>

<style scoped src="./ResourceTreeItem.styles.css"></style>

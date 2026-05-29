<!--
  @file CanvasToolbar.vue
  @description 画布工具栏组件

  职责：
  - 节点布局整理控制（一键整理）
  - 聚焦到项目根节点
  - 删除选中节点
  - 显示节点统计信息
-->

<template>
  <div v-if="nodeOrganizer.statistics.value.total > 0" class="node-organizer-toolbar">
    <button
      class="organize-btn focus-project-btn"
      @click="focusToProjectRoot"
      title="聚焦到项目起始点 (Ctrl+H)"
    >
      <span class="btn-icon">⌖</span>
      <span class="btn-text">{{ t('canvas.nodeCanvas.focusProject') || '聚焦项目' }}</span>
    </button>

    <div class="toolbar-separator"></div>

    <button
      class="organize-btn organize-primary"
      @click="nodeOrganizer.quickOrganize"
      :disabled="nodeOrganizer.isOrganizing.value"
      title="整理节点布局"
    >
      <span class="btn-icon">⊞</span>
      <span class="btn-text">{{
        nodeOrganizer.isOrganizing.value ? '整理中...' : '整理节点'
      }}</span>
    </button>

    <div class="toolbar-separator"></div>

    <button
      class="organize-btn danger"
      @click="handleDeleteSelected"
      :disabled="store.selectedNodeIds.length === 0"
      :title="t('canvas.nodeCanvas.deleteSelected') || '删除选中'"
    >
      <span class="btn-icon">✕</span>
      <span class="btn-text">{{ t('canvas.nodeCanvas.deleteSelected') || '删除选中' }}</span>
    </button>

    <div class="organize-stats">
      <span class="stat-item">总计: {{ nodeOrganizer.statistics.value.total }}</span>
      <span v-if="zoneGroups.length > 0" class="stat-item groups"
        >分组: {{ zoneGroups.length }}</span
      >
      <span v-if="nodeOrganizer.statistics.value.selected > 0" class="stat-item selected"
        >选中: {{ nodeOrganizer.statistics.value.selected }}</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useVueFlow } from '@vue-flow/core'
  import { useGraphStore } from '@/stores/graphStore'
  import { useNodeOrganizer } from '@/features/node-layout-organizer/composables/useNodeOrganizer'
  import { deleteNode } from '@/features/keyboard/handlers/node/delete'

  const { t } = useI18n()
  const store = useGraphStore()
  const nodeOrganizer = useNodeOrganizer()
  const zoneGroups = nodeOrganizer.groups
  const { fitView } = useVueFlow()

  const focusToProjectRoot = () => {
    store.nodes.forEach((node) => {
      if ((node as unknown as Record<string, unknown>).hidden) {
        ;(node as unknown as Record<string, unknown>).hidden = false
      }
    })

    const projectNode = store.nodes.find((n) => n.type === 'projectRoot')
    if (projectNode) {
      fitView({
        nodes: [projectNode.id],
        padding: 0.5,
        duration: 300,
      })
    }
  }

  const handleDeleteSelected = async () => {
    await deleteNode()
  }
</script>

<style scoped src="./CanvasToolbar.styles.css"></style>

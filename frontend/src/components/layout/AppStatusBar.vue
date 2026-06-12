<!--
  @file AppStatusBar.vue
  @description 应用状态栏组件

  职责：
  - 显示当前项目名称（已打开）或提示未打开项目
  - 点击可切换/打开项目
-->

<template>
  <div class="status-bar">
    <button
      class="project-chip"
      type="button"
      :title="
        projectStore.isProjectActive
          ? projectStore.currentPaths?.configPath
          : t('common.projectManagement.openProject')
      "
      @click="emit('openProjectManagement')"
    >
      <span v-if="projectStore.isProjectActive" class="project-dot" />
      <span class="project-icon">{{ projectStore.isProjectActive ? '📂' : '📁' }}</span>
      <span class="project-name">{{
        projectStore.isProjectActive
          ? graphStore.projectName || projectStore.currentPaths?.configPath
          : t('common.projectManagement.noProject')
      }}</span>
    </button>

    <!-- 配置自检状态徽章（无问题时自动隐藏） -->
    <InspectionStatusBadge />
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useProjectStore } from '@/stores/projectStore'
  import InspectionStatusBadge from '@/components/inspection/InspectionStatusBadge.vue'

  const emit = defineEmits<{
    openProjectManagement: []
  }>()

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const projectStore = useProjectStore()
</script>

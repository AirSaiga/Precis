<!--
  @file AppStatusBar.vue
  @description 应用状态栏组件

  职责：
  - 显示当前项目信息（名称、路径）
  - 显示项目统计（Schema、Constraint、Regex 数量）
  - 显示保存状态
  - 提供全量校验入口
  - 项目切换/打开入口
-->

<template>
  <div class="status-bar">
    <div class="status-left">
      <button
        v-if="projectStore.isProjectActive"
        class="status-item project-info clickable"
        type="button"
        :title="t('common.projectManagement.switchProject')"
        @click="emit('openProjectManagement')"
      >
        <span class="icon">📂</span>
        <span class="text" :title="projectStore.currentPaths?.configPath">
          {{ graphStore.projectName || projectStore.currentPaths?.configPath }}
        </span>
      </button>
      <template v-if="projectStore.isProjectActive">
        <span class="project-stats">
          <span class="stat-item" :title="t('statusBar.schema')">
            <span class="stat-label">{{ t('statusBar.schema') }}:</span>
            <span class="stat-value">{{ projectStats.schemaCount }}</span>
          </span>
          <span class="stat-item" :title="constraintTooltip">
            <span class="stat-label">{{ t('statusBar.constraint') }}:</span>
            <span class="stat-value">{{ projectStats.constraintCount }}</span>
          </span>
          <span class="stat-item" :title="t('statusBar.regex')">
            <span class="stat-label">{{ t('statusBar.regex') }}:</span>
            <span class="stat-value">{{ projectStats.regexCount }}</span>
          </span>
          <span class="stat-item" :title="t('statusBar.transforms')">
            <span class="stat-label">{{ t('statusBar.transforms') }}:</span>
            <span class="stat-value">{{ projectStats.transformCount }}</span>
          </span>
        </span>
      </template>
      <button
        v-else
        class="status-item project-info clickable"
        type="button"
        :title="t('common.projectManagement.openProject')"
        @click="emit('openProjectManagement')"
      >
        <span class="icon">📁</span>
        <span class="text">{{ t('common.projectManagement.noProject') }}</span>
      </button>
      <span v-if="projectStore.isProjectActive" class="separator">|</span>
      <span class="status-text">{{ statusMessage }}</span>
    </div>
    <div class="status-right">
      <button
        class="status-action ui-btn ui-btn--toolbar"
        type="button"
        @click="validationTaskStore.openFullProject()"
      >
        {{ t('common.fullValidation.entry') }}
      </button>
      <span class="save-status" :class="{ 'has-changes': graphStore.hasUnsavedChanges() }">
        {{ saveStatusText }}
      </span>
      <span class="separator">|</span>
      <span class="status-text">就绪</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'

  const emit = defineEmits<{
    openProjectManagement: []
  }>()

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const projectStore = useProjectStore()
  const resourceTreeStore = useResourceTreeStore()
  const validationTaskStore = useValidationTaskStore()

  const statusMessage = '就绪'

  const projectStats = computed(() => ({
    schemaCount: resourceTreeStore.schemas.length,
    constraintCount: graphStore.projectConfigStatsLoaded
      ? graphStore.projectConfigStats.constraintCount
      : resourceTreeStore.constraints.length,
    regexCount: resourceTreeStore.regexNodes.length,
    transformCount: graphStore.projectConfigStatsLoaded
      ? graphStore.projectConfigStats.transformCount
      : 0,
  }))

  const constraintTooltip = computed(() => {
    if (graphStore.projectConfigStatsLoaded) {
      return `${t('statusBar.constraint')} (${t('aiConfigGenerator.result.stats.standalone')}: ${graphStore.projectConfigStats.constraintStandaloneCount}, ${t('aiConfigGenerator.result.stats.inline')}: ${graphStore.projectConfigStats.constraintInlineCount})`
    }
    return t('statusBar.constraint')
  })

  const saveStatusText = computed(() => {
    const summary = graphStore.getSaveStatusSummary()
    if (summary.hasChanges) {
      return summary.unsaved > 0 ? `有 ${summary.unsaved} 个未保存的修改` : '有未保存的修改'
    }
    return '已保存'
  })
</script>

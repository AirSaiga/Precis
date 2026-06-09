<!--
  @file ProjectRootNode.vue
  @description 项目根节点组件 - 极简视觉锚点
  展示项目名称、路径、状态指示、摘要统计和核心操作入口。
  详情和更多操作通过 Inspector 面板和右键菜单访问。
-->
<template>
  <div
    class="project-root-node graph-node"
    :class="{ 'is-selected': selected }"
    @dblclick="openSettings"
  >
    <div class="header">
      <div class="icon">🔬</div>
      <div class="header-text">
        <div class="title">{{ data.projectName }}</div>
        <div class="subtitle" :title="data.projectPath || '-'">{{ projectPathShort }}</div>
      </div>
      <div class="status-indicators">
        <span
          v-if="!graphStore.isProjectLoaded"
          class="status-indicator loading"
          :title="t('customNodes.projectRootNode.status.loading')"
        >
          ⏳
        </span>
        <span
          v-if="hasUnsavedChanges"
          class="status-indicator unsaved"
          :title="t('customNodes.projectRootNode.status.unsaved')"
        >
          ●
        </span>
      </div>
    </div>

    <div class="content-body">
      <div class="summary-row">
        <div class="summary-item">
          <span class="count">{{ schemaCount }}</span>
          <span>{{ t('customNodes.projectRootNode.summary.schemas') }}</span>
        </div>
        <div class="summary-item">
          <span class="count">{{ constraintCount }}</span>
          <span>{{ t('customNodes.projectRootNode.summary.constraints') }}</span>
        </div>
        <div class="summary-item">
          <span class="count">{{ regexCount }}</span>
          <span>{{ t('customNodes.projectRootNode.summary.regex') }}</span>
        </div>
      </div>

      <div v-if="hasValidationResult" class="pass-rate-row" :class="passRateClass">
        <span class="pass-rate-icon">{{ passRateIcon }}</span>
        <span class="pass-rate-value">{{ passRateText }}</span>
        <span v-if="errorCount > 0" class="pass-rate-errors">
          ({{ errorCount }} {{ t('customNodes.projectRootNode.errors') }})
        </span>
      </div>

      <div class="actions">
        <button class="btn btn-primary" type="button" @click="openFullValidation">
          ▶ {{ t('customNodes.projectRootNode.actions.fullValidation') }}
        </button>
        <button class="btn btn-icon" type="button" :title="t('customNodes.projectRootNode.actions.reload')" @click="reloadProject">
          ↻
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
  import { eventBus } from '@/core/eventBus'
  import type { ProjectNodeData } from '@/types/graph'

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const settingsStore = useSettingsStore()
  const resourceTreeStore = useResourceTreeStore()
  const validationTaskStore = useValidationTaskStore()

  const props = defineProps<{
    data: ProjectNodeData
    selected?: boolean
  }>()

  // 项目路径缩短显示
  const projectPathShort = computed(() => {
    const path = props.data.projectPath || '-'
    // 如果路径太长，只显示最后两级目录
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length > 2) {
      return `.../${parts.slice(-2).join('/')}`
    }
    return path
  })

  // 统计数据直接从 store 读取
  const schemaCount = computed(() => resourceTreeStore.schemas.length)
  const constraintCount = computed(() =>
    resourceTreeStore.independentConstraintsManifestCount +
    resourceTreeStore.embeddedConstraintsManifestCount +
    resourceTreeStore.independentConstraintsUnlistedCount +
    resourceTreeStore.embeddedConstraintsUnlistedCount
  )
  const regexCount = computed(() => resourceTreeStore.regexNodes.length)

  const validationSummary = computed(() => graphStore.lastFullValidationSummary)
  const validationStatistics = computed(() => graphStore.lastFullValidationStatistics)

  const hasValidationResult = computed(() => !!validationSummary.value || !!validationStatistics.value)

  const passRateText = computed(() => {
    const statistics = validationStatistics.value
    if (statistics && Number.isFinite(statistics.pass_rate)) {
      return `${Math.round(statistics.pass_rate)}%`
    }
    const summary = validationSummary.value
    if (!summary) return '-'
    if (summary.total_error_count === 0) return '100%'
    return '0%'
  })

  const errorCount = computed(() => validationSummary.value?.total_error_count ?? 0)

  const passRateClass = computed(() => {
    const statistics = validationStatistics.value
    if (!statistics) return 'no-data'
    if (statistics.pass_rate >= 100) return 'pass'
    if (statistics.pass_rate >= 60) return 'partial'
    return 'fail'
  })

  const passRateIcon = computed(() => {
    if (passRateClass.value === 'pass') return '✅'
    if (passRateClass.value === 'partial') return '⚠️'
    return '❌'
  })

  const hasUnsavedChanges = computed(() => graphStore.hasUnsavedChanges())

  const openFullValidation = () => {
    validationTaskStore.openFullProject()
  }

  const openSettings = () => {
    settingsStore.open()
    settingsStore.setActiveTab('project')
  }

  const reloadProject = async () => {
    await graphStore.loadProjectFromV2()
    eventBus.emit('project-applied')
  }
</script>

<style scoped src="./ProjectRootNode.styles.css"></style>

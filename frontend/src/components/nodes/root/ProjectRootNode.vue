<!--
  @file ProjectRootNode.vue
  @description 项目根节点组件 - 项目信息展示、统计指标与操作入口
-->

/** * @file ProjectRootNode.vue * @description 项目根节点组件 * * 核心功能： * -
显示项目名称和路径信息 * - 展示项目统计指标（Schema数量、约束数量、Regex数量） * - 显示校验通过率 *
- 提供项目操作入口（校验、导出、AI生成、重新加载、项目管理、关闭） * - 双击打开项目设置 * *
节点结构： * - Header：项目图标和项目名称 * - Metrics Row：统计指标展示 * - Actions
Row：操作按钮区域 */
<template>
  <div
    class="project-root-node graph-node"
    :class="{ 'is-selected': selected }"
    @dblclick="openSettings"
    @contextmenu.prevent="showContextMenu"
  >
    <div class="root-badge">{{ t('customNodes.projectRootNode.rootBadge') || '项目起始点' }}</div>
    <div class="header">
      <span class="icon">🔰</span>
      <div class="header-text">
        <div class="title">{{ data.projectName }}</div>
        <div class="subtitle" :title="data.projectPath || '-'">{{ data.projectPath || '-' }}</div>
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
      <div class="metrics">
        <div class="metric">
          <div class="metric-label">{{ t('customNodes.projectRootNode.metrics.schemas') }}</div>
          <div class="metric-value">{{ schemaCountText }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">{{ t('customNodes.projectRootNode.metrics.constraints') }}</div>
          <div class="metric-value">{{ constraintCountText }}</div>
          <div class="metric-sub">
            <span :title="t('aiConfigGenerator.result.stats.standalone')"
              >S: {{ constraintStandaloneText }}</span
            >
            <span class="divider">/</span>
            <span :title="t('aiConfigGenerator.result.stats.inline')"
              >I: {{ constraintInlineText }}</span
            >
          </div>
        </div>
        <div class="metric">
          <div class="metric-label">{{ t('customNodes.projectRootNode.metrics.regex') }}</div>
          <div class="metric-value">{{ regexCountText }}</div>
        </div>
        <div class="metric">
          <div class="metric-label">{{ t('customNodes.projectRootNode.metrics.transforms') }}</div>
          <div class="metric-value">{{ transformCountText }}</div>
        </div>
        <div class="metric metric-wide">
          <div class="metric-label">{{ t('customNodes.projectRootNode.metrics.passRate') }}</div>
          <div class="metric-value pass-rate">
            <span class="rate-value">{{ passRateText }}</span>
            <span v-if="validationSummary" class="rate-detail">
              ({{ validationSummary.total_error_count }}
              {{ t('customNodes.projectRootNode.errors') }})
            </span>
          </div>
        </div>
      </div>

      <div v-if="data.createdAt" class="created-time">
        <span class="label">{{ t('customNodes.projectRootNode.createdAt') }}:</span>
        <span class="time">{{ formatCreatedTime(data.createdAt) }}</span>
      </div>

      <div class="actions">
        <button class="btn" type="button" @click="openFullValidation">
          {{ t('customNodes.projectRootNode.actions.fullValidation') }}
        </button>
        <button class="btn" type="button" @click="exportFullConfig">
          {{ t('customNodes.projectRootNode.actions.export') }}
        </button>
        <button class="btn" type="button" @click="openAiConfigGenerator">
          {{ t('customNodes.projectRootNode.actions.aiGenerate') }}
        </button>
        <button class="btn" type="button" @click="reloadProject">
          {{ t('customNodes.projectRootNode.actions.reload') }}
        </button>
        <button class="btn" type="button" @click="openProjectManagement">
          {{ t('customNodes.projectRootNode.actions.projectManagement') }}
        </button>
        <button class="btn btn-danger" type="button" @click="closeProject">
          {{ t('customNodes.projectRootNode.actions.closeProject') }}
        </button>
      </div>
    </div>

    <div v-if="contextMenuVisible" class="context-menu" :style="contextMenuStyle" @click.stop>
      <div class="context-menu-item" @click="openSettings">
        <span class="menu-icon">⚙️</span>
        {{ t('customNodes.projectRootNode.contextMenu.settings') }}
      </div>
      <div class="context-menu-item" @click="openFullValidation">
        <span class="menu-icon">✓</span>
        {{ t('customNodes.projectRootNode.actions.fullValidation') }}
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" @click="openProjectManagement">
        <span class="menu-icon">📁</span>
        {{ t('customNodes.projectRootNode.actions.projectManagement') }}
      </div>
      <div class="context-menu-item" @click="reloadProject">
        <span class="menu-icon">🔄</span>
        {{ t('customNodes.projectRootNode.actions.reload') }}
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item danger" @click="closeProject">
        <span class="menu-icon">✕</span>
        {{ t('customNodes.projectRootNode.actions.closeProject') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, ref, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'
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

  const contextMenuVisible = ref(false)
  const contextMenuPosition = ref({ x: 0, y: 0 })

  /**
   * 计算 Schema 数量
   * 使用 resourceTreeStore 保持与状态栏计数一致
   */
  const schemaManifestCount = computed(() => resourceTreeStore.schemasManifestCount)
  const schemaUnlistedCount = computed(() => resourceTreeStore.schemasUnlistedCount)
  const schemaCountText = computed(() => {
    const total = resourceTreeStore.schemas.length
    const unlisted = schemaUnlistedCount.value
    return unlisted > 0 ? `${total} (M:${schemaManifestCount.value}/U:${unlisted})` : String(total)
  })

  /**
   * 计算约束规则数量
   * 使用 graphStore.projectConfigStats 保持与 stats.ts 计算逻辑一致（独立约束 + 内嵌约束）
   */
  const constraintStandaloneManifestCount = computed(
    () => resourceTreeStore.independentConstraintsManifestCount
  )
  const constraintStandaloneUnlistedCount = computed(
    () => resourceTreeStore.independentConstraintsUnlistedCount
  )
  const constraintInlineManifestCount = computed(
    () => resourceTreeStore.embeddedConstraintsManifestCount
  )
  const constraintInlineUnlistedCount = computed(
    () => resourceTreeStore.embeddedConstraintsUnlistedCount
  )

  const constraintManifestCount = computed(
    () => constraintStandaloneManifestCount.value + constraintInlineManifestCount.value
  )
  const constraintUnlistedCount = computed(
    () => constraintStandaloneUnlistedCount.value + constraintInlineUnlistedCount.value
  )
  const constraintCountText = computed(() => {
    const base = constraintManifestCount.value
    const extra = constraintUnlistedCount.value
    return extra > 0 ? `${base} (+${extra})` : String(base)
  })
  const constraintStandaloneText = computed(() => {
    const base = constraintStandaloneManifestCount.value
    const extra = constraintStandaloneUnlistedCount.value
    return extra > 0 ? `${base} (+${extra})` : String(base)
  })
  const constraintInlineText = computed(() => {
    const base = constraintInlineManifestCount.value
    const extra = constraintInlineUnlistedCount.value
    return extra > 0 ? `${base} (+${extra})` : String(base)
  })

  /**
   * 计算正则表达式数量
   * 使用 resourceTreeStore 保持与状态栏计数一致
   */
  const regexManifestCount = computed(() => resourceTreeStore.regexNodesManifestCount)
  const regexUnlistedCount = computed(() => resourceTreeStore.regexNodesUnlistedCount)
  const regexCountText = computed(() => {
    const total = resourceTreeStore.regexNodes.length
    const unlisted = regexUnlistedCount.value
    return unlisted > 0 ? `${total} (M:${regexManifestCount.value}/U:${unlisted})` : String(total)
  })

  const transformCountText = computed(() => {
    return String(graphStore.projectConfigStats.transformCount || 0)
  })

  const validationSummary = computed(() => {
    return graphStore.lastFullValidationSummary
  })

  const validationStatistics = computed(() => {
    return graphStore.lastFullValidationStatistics
  })

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

  const hasUnsavedChanges = computed(() => {
    return graphStore.hasUnsavedChanges()
  })

  const contextMenuStyle = computed(() => {
    return {
      left: `${contextMenuPosition.value.x}px`,
      top: `${contextMenuPosition.value.y}px`,
    }
  })

  const formatCreatedTime = (dateStr: string): string => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } else if (diffDays === 1) {
        return t('customNodes.projectRootNode.time.yesterday')
      } else if (diffDays < 7) {
        return t('customNodes.projectRootNode.time.daysAgo', { days: diffDays })
      } else {
        return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
      }
    } catch {
      return dateStr
    }
  }

  const showContextMenu = (event: MouseEvent) => {
    contextMenuPosition.value = { x: event.offsetX, y: event.offsetY }
    contextMenuVisible.value = true
  }

  const hideContextMenu = () => {
    contextMenuVisible.value = false
  }

  const openFullValidation = () => {
    hideContextMenu()
    validationTaskStore.openFullProject()
  }

  const openSettings = () => {
    hideContextMenu()
    settingsStore.open()
    settingsStore.setActiveTab('project')
  }

  const exportFullConfig = () => {
    hideContextMenu()
    window.dispatchEvent(new CustomEvent('export-full-config-yaml'))
  }

  const openAiConfigGenerator = () => {
    hideContextMenu()
    window.dispatchEvent(new CustomEvent('open-ai-config-generator'))
  }

  const reloadProject = async () => {
    hideContextMenu()
    await graphStore.loadProjectFromV2()
    window.dispatchEvent(new CustomEvent('project-applied'))
  }

  const openProjectManagement = () => {
    hideContextMenu()
    settingsStore.open('project-info')
  }

  const closeProject = () => {
    hideContextMenu()
    if (confirm(t('customNodes.projectRootNode.confirm.closeProject'))) {
      graphStore.clearProject()
      window.dispatchEvent(new CustomEvent('project-closed'))
    }
  }

  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (!target.closest('.context-menu')) {
      hideContextMenu()
    }
  }

  onMounted(() => {
    if (graphStore.projectConfigStatsLoaded) return
    void graphStore.refreshProjectConfigStats(props.data.projectPath)
    document.addEventListener('click', handleClickOutside)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside)
  })
</script>

<style scoped src="./ProjectRootNode.styles.css"></style>

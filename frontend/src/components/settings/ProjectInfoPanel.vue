<!--
  @file ProjectInfoPanel.vue
  @description 项目信息设置面板组件

  用于展示和编辑项目的基本信息，包括项目名称、描述等元数据。
-->
<template>
  <div class="ui-workbench-page project-info-page">
    <!-- 1. Hero card -->
    <section class="ui-workbench-card hero-card">
      <div class="hero-row">
        <div class="ui-avatar">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>
        <div class="hero-row__main">
          <input
            v-model="localProjectName"
            class="ui-input"
            type="text"
            :placeholder="t('settings.projectInfo.namePlaceholder')"
            :disabled="!projectStore.isProjectActive"
            @blur="handleNameChange"
            @keydown.enter="handleNameChange"
          />
        </div>
        <div class="hero-row__actions">
          <button class="ui-btn ui-btn--ghost ui-btn--sm" @click="selectConfigPath">
            {{ t('settings.projectInfo.browse') }}
          </button>
          <button
            class="ui-btn ui-btn--primary ui-btn--sm"
            :disabled="!canApply || isApplying"
            @click="applyChanges"
          >
            {{ isApplying ? t('settings.projectInfo.applying') : applyButtonText }}
          </button>
        </div>
      </div>
    </section>

    <!-- 2. Status row -->
    <section class="status-row">
      <div class="status-row__pill" :class="statusVariant">
        <span class="status-row__pill-dot"></span>
        <span>{{ projectStatusText }}</span>
      </div>
      <div class="ui-card status-row__path">
        <div class="path-header">
          <span class="ui-badge">{{ t('settings.projectInfo.currentPath') }}</span>
          <span class="path-hint">{{ t('settings.projectInfo.pathHint') }}</span>
        </div>
        <div
          class="path-text"
          :title="localConfigPath || t('settings.projectInfo.missingConfigPath')"
        >
          {{ localConfigPath || t('settings.projectInfo.missingConfigPath') }}
        </div>
      </div>
    </section>

    <!-- 3. Stats grid -->
    <section class="ui-workbench-grid ui-workbench-grid--three stats-grid">
      <div class="ui-workbench-card stat-card">
        <span class="stat-label">{{ t('settings.projectInfo.resourceSummary') }}</span>
        <strong class="stat-value">{{ totalTrackedResources }}</strong>
        <span class="stat-desc">{{ t('settings.projectInfo.resourceSummaryDesc') }}</span>
      </div>

      <div class="ui-workbench-card stat-card">
        <span class="stat-label">{{ t('settings.dataSources.title') }}</span>
        <strong class="stat-value">{{ dataSourceCount }}</strong>
        <span class="stat-desc">{{ t('settings.projectInfo.dataSourcesSummaryDesc') }}</span>
      </div>

      <div class="ui-workbench-card stat-card">
        <span class="stat-label">{{ t('settings.projectInfo.currentState') }}</span>
        <strong class="stat-value">{{ projectStateLabel }}</strong>
        <span class="stat-desc">{{ t('settings.projectInfo.currentStateDesc') }}</span>
      </div>
    </section>

    <!-- 4. Resource detail grid -->
    <section class="ui-workbench-grid ui-workbench-grid--three stats-grid">
      <div class="ui-workbench-card stat-card">
        <span class="stat-label">{{ t('settings.projectInfo.schemas') }}</span>
        <strong class="stat-value">{{ schemaCountText }}</strong>
        <span class="stat-desc">{{ t('settings.projectInfo.schemaDetail') }}</span>
      </div>

      <div class="ui-workbench-card stat-card">
        <span class="stat-label">{{ t('settings.projectInfo.constraints') }}</span>
        <strong class="stat-value">{{ constraintCountText }}</strong>
        <span class="stat-desc">{{
          t('settings.projectInfo.constraintDetail', {
            standalone: constraintStandaloneText,
            inline: constraintInlineText,
          })
        }}</span>
      </div>

      <div class="ui-workbench-card stat-card">
        <span class="stat-label">{{ t('settings.projectInfo.regexes') }}</span>
        <strong class="stat-value">{{ regexCountText }}</strong>
        <span class="stat-desc">{{ t('settings.projectInfo.regexDetail') }}</span>
      </div>
    </section>

    <div class="page-footer" v-if="projectStore.isProjectActive">
      <div class="footer-status">
        <span class="status-dot" :class="statusVariant"></span>
        <span class="status-text">{{ projectStatusText }}</span>
      </div>

      <div class="footer-actions">
        <button
          class="ui-btn ui-btn--ghost ui-btn--sm"
          :disabled="!hasChanges || isApplying"
          @click="resetChanges"
        >
          {{ t('common.reset') }}
        </button>

        <button
          class="ui-btn ui-btn--primary ui-btn--sm"
          :disabled="!canApply || isApplying"
          @click="applyChanges"
        >
          {{ isApplying ? t('settings.projectInfo.applying') : applyButtonText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useProjectStore } from '@/stores/projectStore'
  import { useGraphStore } from '@/stores/graphStore'
  import { useResourceTreeStore } from '@/stores/resourceTreeStore'
  import { useToast } from '@/composables/shared'
  import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
  import { getV2Manifest, putV2Manifest } from '@/api/projectV2Api'
  import type { ProjectManifestV2 } from '@/types/projectV2'

  const { t } = useI18n()
  const projectStore = useProjectStore()
  const graphStore = useGraphStore()
  const resourceTreeStore = useResourceTreeStore()
  const { success, warning } = useToast()

  // 本地状态
  const localProjectName = ref(graphStore.projectName || '')
  const originalProjectName = ref(graphStore.projectName || '')
  const localConfigPath = ref(projectStore.currentPaths?.configPath || '')
  const isApplying = ref(false)
  const dataSourceCount = ref(0)

  // 监听外部变化
  watch(
    () => projectStore.isProjectActive,
    (active) => {
      if (active) {
        loadDataSourceCount()
      }
    }
  )

  watch(
    () => projectStore.currentPaths,
    (paths) => {
      if (paths) {
        localConfigPath.value = paths.configPath || ''
      }
    },
    { deep: true }
  )

  watch(
    () => graphStore.projectName,
    (name) => {
      localProjectName.value = name || ''
      originalProjectName.value = name || ''
    }
  )

  async function loadDataSourceCount(): Promise<void> {
    if (!projectStore.isProjectActive) {
      dataSourceCount.value = 0
      return
    }
    try {
      const manifest: ProjectManifestV2 = await getV2Manifest()
      dataSourceCount.value = (manifest.data_sources || []).length
    } catch {
      dataSourceCount.value = 0
    }
  }

  const schemaCountText = computed(() => {
    const total = resourceTreeStore.schemas.length
    const manifestCount = resourceTreeStore.schemasManifestCount
    const unlisted = resourceTreeStore.schemasUnlistedCount
    return unlisted > 0 ? `${total} (M:${manifestCount}/U:${unlisted})` : String(total)
  })

  const constraintCountText = computed(() => {
    const base =
      resourceTreeStore.independentConstraintsManifestCount +
      resourceTreeStore.embeddedConstraintsManifestCount
    const extra =
      resourceTreeStore.independentConstraintsUnlistedCount +
      resourceTreeStore.embeddedConstraintsUnlistedCount
    return extra > 0 ? `${base} (+${extra})` : String(base)
  })

  const constraintStandaloneText = computed(() => {
    const base = resourceTreeStore.independentConstraintsManifestCount
    const extra = resourceTreeStore.independentConstraintsUnlistedCount
    return extra > 0 ? `${base} (+${extra})` : String(base)
  })

  const constraintInlineText = computed(() => {
    const base = resourceTreeStore.embeddedConstraintsManifestCount
    const extra = resourceTreeStore.embeddedConstraintsUnlistedCount
    return extra > 0 ? `${base} (+${extra})` : String(base)
  })

  const regexCountText = computed(() => {
    const total = resourceTreeStore.regexNodes.length
    const manifestCount = resourceTreeStore.regexNodesManifestCount
    const unlisted = resourceTreeStore.regexNodesUnlistedCount
    return unlisted > 0 ? `${total} (M:${manifestCount}/U:${unlisted})` : String(total)
  })

  const totalTrackedResources = computed(() => {
    return String(
      resourceTreeStore.schemas.length +
        resourceTreeStore.regexNodes.length +
        resourceTreeStore.independentConstraintsManifestCount +
        resourceTreeStore.embeddedConstraintsManifestCount +
        resourceTreeStore.independentConstraintsUnlistedCount +
        resourceTreeStore.embeddedConstraintsUnlistedCount
    )
  })

  const hasChanges = computed(() => {
    const currentPaths = projectStore.currentPaths
    const pathChanged = localConfigPath.value !== (currentPaths?.configPath || '')
    const nameChanged = localProjectName.value !== originalProjectName.value
    return pathChanged || nameChanged
  })

  const applyButtonText = computed(() => {
    return projectStore.isProjectActive ? t('settings.projectInfo.apply') : t('common.openProject')
  })

  const canApply = computed(() => {
    if (!projectStore.isProjectActive) {
      return !!localConfigPath.value.trim()
    }
    return hasChanges.value
  })

  const statusVariant = computed(() => {
    if (isApplying.value) return 'is-applying'
    if (!projectStore.isProjectActive) return 'is-inactive'
    if (hasChanges.value) return 'is-warning'
    return 'is-ready'
  })

  const projectStatusText = computed(() => {
    if (isApplying.value) return t('settings.projectInfo.applying')
    if (!projectStore.isProjectActive) return t('settings.projectInfo.statusInactive')
    if (hasChanges.value) return t('settings.projectInfo.statusPending')
    return t('settings.projectInfo.statusReady')
  })

  const projectStateLabel = computed(() => {
    if (!projectStore.isProjectActive) return t('settings.projectInfo.statusInactive')
    return hasChanges.value
      ? t('settings.projectInfo.statusPending')
      : t('settings.projectInfo.statusReady')
  })

  function handleNameChange(): void {
    if (localProjectName.value && localProjectName.value !== graphStore.projectName) {
      graphStore.projectName = localProjectName.value
    }
  }

  const normalizeDir = (input: string): string => {
    return (input || '')
      .replace(/[\r\n"]/g, '')
      .trim()
      .replace(/[\\/]+$/, '')
  }

  const selectConfigPath = async () => {
    const path = await selectDirectory(t('settings.projectInfo.selectConfigPath'))
    if (path) {
      localConfigPath.value = path
    }
  }

  const selectDirectory = async (dialogTitle: string): Promise<string> => {
    if (isElectron()) {
      try {
        const api = getElectronAPI()
        if (api) {
          const result = await api.showOpenDialog({
            title: dialogTitle,
            buttonLabel: t('settings.projectInfo.selectButton'),
            properties: ['openDirectory'],
          })
          if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
            return result.filePaths[0]
          }
        }
      } catch (error) {
        logger.error('Electron 目录选择失败:', error)
      }
      return ''
    } else {
      warning('当前环境不支持目录选择器，请手动输入绝对路径', '提示')
      return ''
    }
  }

  const resetChanges = () => {
    const currentPaths = projectStore.currentPaths
    localConfigPath.value = currentPaths?.configPath || ''
    localProjectName.value = originalProjectName.value
  }

  const applyChanges = async () => {
    const configPath = normalizeDir(localConfigPath.value)

    if (!configPath) {
      warning(t('settings.projectInfo.missingConfigPath'), t('common.error'))
      return
    }

    isApplying.value = true
    try {
      const currentConfigPath = projectStore.currentPaths?.configPath
      const pathsChanged = configPath !== currentConfigPath

      if (window.electronAPI?.saveConfig) {
        await window.electronAPI.saveConfig(configPath, configPath)
      }

      projectStore.setProjectPaths({ configPath, dataPath: configPath })

      if (projectStore.isProjectActive) {
        const manifest = await getV2Manifest()
        manifest.project.name = localProjectName.value
        await putV2Manifest(manifest)
        originalProjectName.value = localProjectName.value
      }

      if (pathsChanged || !projectStore.isProjectActive) {
        const loaded = await graphStore.loadProjectFromV2()
        if (loaded) {
          success(
            projectStore.isProjectActive
              ? t('settings.projectInfo.appliedDesc')
              : t('settings.projectInfo.openedDesc'),
            projectStore.isProjectActive
              ? t('settings.projectInfo.appliedTitle')
              : t('settings.projectInfo.openedTitle')
          )
        } else {
          warning(t('settings.projectInfo.loadFailed'), t('common.error'))
        }
      } else {
        success(t('settings.projectInfo.appliedDesc'), t('settings.projectInfo.appliedTitle'))
      }

      localStorage.setItem('resourceTreeExpanded', 'true')
      window.dispatchEvent(new CustomEvent('project-applied'))
    } catch (error) {
      logger.error('[ProjectInfoPanel] 应用路径更改失败:', error)
      warning(t('settings.projectInfo.applyFailed'), t('common.error'))
    } finally {
      isApplying.value = false
    }
  }
</script>

<style scoped src="./ProjectInfoPanel.styles.css"></style>

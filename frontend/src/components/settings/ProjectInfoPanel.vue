<!--
  @file ProjectInfoPanel.vue
  @description 项目信息设置面板组件（macOS 风格）

  用于展示和编辑项目的基本信息，包括项目名称、工程路径、资源统计等。
-->

<template>
  <div class="settings-page">
    <!-- 基本信息 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.projectInfo.basicInfo') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.projectInfo.name') }}</div>
        <div class="settings-row__desc"></div>
        <div class="settings-row__control settings-row__control--wide">
          <input
            v-model="localProjectName"
            class="settings-input"
            type="text"
            :placeholder="t('settings.projectInfo.namePlaceholder')"
            :disabled="!projectStore.isProjectActive && !localConfigPath"
            @blur="handleNameChange"
            @keydown.enter="handleNameChange"
          />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.projectInfo.configPath') }}</div>
        <div class="settings-row__desc">{{ t('settings.projectInfo.pathHint') }}</div>
        <div class="settings-row__control settings-row__control--wide">
          <div class="settings-code" :title="localConfigPath || t('settings.projectInfo.missingConfigPath')">
            {{ localConfigPath || t('settings.projectInfo.missingConfigPath') }}
          </div>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.projectInfo.currentState') }}</div>
        <div class="settings-row__desc"></div>
        <div class="settings-row__control">
          <span class="settings-pill" :class="statusVariant">
            <span class="settings-pill__dot"></span>
            {{ projectStatusText }}
          </span>
        </div>
      </div>
    </div>

    <!-- 资源统计 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.projectInfo.stats') }}</div>
        <div class="settings-section__desc">{{ t('settings.projectInfo.statsDesc') }}</div>
      </div>
      <div class="settings-stat-grid">
        <div class="settings-stat">
          <span class="settings-stat__label">{{ t('settings.projectInfo.resourceSummary') }}</span>
          <strong class="settings-stat__value">{{ totalTrackedResources }}</strong>
          <span class="settings-stat__desc">{{ t('settings.projectInfo.resourceSummaryDesc') }}</span>
        </div>
        <div class="settings-stat">
          <span class="settings-stat__label">{{ t('settings.dataSources.title') }}</span>
          <strong class="settings-stat__value">{{ dataSourceCount }}</strong>
          <span class="settings-stat__desc">{{ t('settings.projectInfo.dataSourcesSummaryDesc') }}</span>
        </div>
        <div class="settings-stat">
          <span class="settings-stat__label">{{ t('settings.projectInfo.schemas') }}</span>
          <strong class="settings-stat__value">{{ schemaCountText }}</strong>
          <span class="settings-stat__desc">{{ t('settings.projectInfo.schemaDetail') }}</span>
        </div>
        <div class="settings-stat">
          <span class="settings-stat__label">{{ t('settings.projectInfo.constraints') }}</span>
          <strong class="settings-stat__value">{{ constraintCountText }}</strong>
          <span class="settings-stat__desc">
            {{ t('settings.projectInfo.constraintDetail', { standalone: constraintStandaloneText, inline: constraintInlineText }) }}
          </span>
        </div>
        <div class="settings-stat">
          <span class="settings-stat__label">{{ t('settings.projectInfo.regexes') }}</span>
          <strong class="settings-stat__value">{{ regexCountText }}</strong>
          <span class="settings-stat__desc">{{ t('settings.projectInfo.regexDetail') }}</span>
        </div>
      </div>
    </div>

    <!-- 操作 -->
    <div v-if="projectStore.isProjectActive" class="settings-actions">
      <button class="ui-btn ui-btn--ghost ui-btn--sm" :disabled="!hasChanges || isApplying" @click="resetChanges">
        {{ t('common.reset') }}
      </button>
      <button class="ui-btn ui-btn--primary ui-btn--sm" :disabled="!canApply || isApplying" @click="applyChanges">
        {{ isApplying ? t('settings.projectInfo.applying') : applyButtonText }}
      </button>
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
  import { eventBus } from '@/core/eventBus'
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
    return projectStore.isProjectActive ? t('settings.projectInfo.apply') : t('settings.projectInfo.openProject')
  })

  const canApply = computed(() => {
    if (!projectStore.isProjectActive) {
      return !!localConfigPath.value.trim()
    }
    return hasChanges.value
  })

  const statusVariant = computed(() => {
    if (isApplying.value) return 'settings-pill--warning'
    if (!projectStore.isProjectActive) return 'settings-pill--danger'
    if (hasChanges.value) return 'settings-pill--warning'
    return 'settings-pill--success'
  })

  const projectStatusText = computed(() => {
    if (isApplying.value) return t('settings.projectInfo.applying')
    if (!projectStore.isProjectActive) return t('settings.projectInfo.statusInactive')
    if (hasChanges.value) return t('settings.projectInfo.statusPending')
    return t('settings.projectInfo.statusReady')
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
            return result.filePaths[0] ?? ''
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
    const previousPaths = projectStore.currentPaths
      ? { ...projectStore.currentPaths }
      : null

    try {
      const currentConfigPath = projectStore.currentPaths?.configPath
      const pathsChanged = configPath !== currentConfigPath
      const wasActive = projectStore.isProjectActive

      if (window.electronAPI?.saveConfig) {
        await window.electronAPI.saveConfig(configPath, configPath)
      }
      projectStore.setProjectPaths({ configPath, dataPath: configPath })

      let loaded = true
      if (pathsChanged || !wasActive) {
        loaded = await graphStore.loadProjectFromV2()
      }

      if (!loaded) {
        if (previousPaths) {
          projectStore.setProjectPaths(previousPaths)
        } else {
          projectStore.clearProject()
        }
        return
      }

      if (projectStore.isProjectActive) {
        try {
          const manifest = await getV2Manifest()
          manifest.project.name = localProjectName.value
          await putV2Manifest(manifest)
          originalProjectName.value = localProjectName.value
        } catch (e) {
          logger.debug('[ProjectInfoPanel] 跳过名称更新，manifest 不存在:', e)
        }
      }

      if (pathsChanged || !wasActive) {
        success(
          wasActive
            ? t('settings.projectInfo.appliedDesc')
            : t('settings.projectInfo.openedDesc'),
          wasActive
            ? t('settings.projectInfo.appliedTitle')
            : t('settings.projectInfo.openedTitle')
        )
      } else {
        success(t('settings.projectInfo.appliedDesc'), t('settings.projectInfo.appliedTitle'))
      }

      localStorage.setItem('resourceTreeExpanded', 'true')
      eventBus.emit('project-applied')
    } catch (error) {
      logger.error('[ProjectInfoPanel] 应用路径更改失败:', error)
      warning(t('settings.projectInfo.applyFailed'), t('common.error'))
      if (previousPaths) {
        projectStore.setProjectPaths(previousPaths)
      } else {
        projectStore.clearProject()
      }
    } finally {
      isApplying.value = false
    }
  }
</script>

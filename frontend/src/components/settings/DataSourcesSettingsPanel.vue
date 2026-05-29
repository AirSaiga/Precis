<!--
  @file DataSourcesSettingsPanel.vue
  @description 数据源设置面板组件（macOS 风格）

  用于配置和管理项目的数据源，支持添加、编辑和删除数据源。
-->

<template>
  <div class="settings-page">
    <!-- 数据源列表 -->
    <div v-if="dataSources.length > 0" class="settings-section">
      <div class="settings-list">
        <div v-for="(ds, index) in dataSources" :key="ds.id" class="settings-list__item" style="flex-direction: column; align-items: stretch; gap: var(--ui-space-sm)">
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.dataSources.id') }}</div>
            <div class="settings-row__control settings-row__control--wide">
              <input v-model="ds.id" class="settings-input" type="text" :placeholder="t('settings.dataSources.idPlaceholder')" :disabled="isSaving" @change="handleChange" />
            </div>
            <button class="ui-icon-btn ui-icon-btn--danger" type="button" :disabled="isSaving" @click="removeDataSource(index)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.dataSources.path') }}</div>
            <div class="settings-row__control settings-row__control--wide">
              <div style="display: flex; gap: var(--ui-space-sm); width: 100%">
                <input v-model="ds.path" class="settings-input" type="text" :placeholder="t('settings.dataSources.pathPlaceholder')" :disabled="isSaving" @change="handleChange" />
                <button class="ui-btn ui-btn--secondary ui-btn--sm" type="button" :disabled="isSaving" @click="selectDirectory(index)">
                  {{ t('settings.dataSources.browse') }}
                </button>
              </div>
            </div>
          </div>
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.dataSources.mode') }}</div>
            <div class="settings-row__control">
              <select v-model="ds.mode" class="settings-select" :disabled="isSaving" @change="handleChange">
                <option value="relative">{{ t('settings.dataSources.modeRelative') }}</option>
                <option value="absolute">{{ t('settings.dataSources.modeAbsolute') }}</option>
              </select>
            </div>
          </div>
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.dataSources.description') }}</div>
            <div class="settings-row__control settings-row__control--wide">
              <input v-model="ds.description" class="settings-input" type="text" :placeholder="t('settings.dataSources.descriptionPlaceholder')" :disabled="isSaving" @change="handleChange" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="dataSources.length === 0" class="ui-empty">
      <div class="ui-empty__icon">📁</div>
      <div class="ui-empty__title">{{ t('settings.dataSources.empty') }}</div>
      <div class="ui-empty__description">{{ t('settings.dataSources.emptyHint') }}</div>
    </div>

    <!-- 操作 -->
    <div class="settings-actions">
      <button class="ui-btn ui-btn--secondary ui-btn--sm" type="button" :disabled="isSaving" @click="addDataSource">
        + {{ t('settings.dataSources.add') }}
      </button>
      <button class="ui-btn ui-btn--ghost ui-btn--sm" type="button" :disabled="isSaving" @click="handleReset">
        {{ t('common.reset') }}
      </button>
      <button class="ui-btn ui-btn--primary ui-btn--sm" type="button" :disabled="isSaving || !hasChanges" @click="handleSave">
        {{ isSaving ? t('common.saving') : t('common.save') }}
      </button>
    </div>

    <div v-if="errorMessage" class="settings-alert settings-alert--danger">
      <span class="settings-alert__icon">✕</span>
      <div class="settings-alert__content">
        <div class="settings-alert__text">{{ errorMessage }}</div>
      </div>
    </div>

    <div v-if="successMessage" class="settings-alert settings-alert--success">
      <span class="settings-alert__icon">✓</span>
      <div class="settings-alert__content">
        <div class="settings-alert__text">{{ successMessage }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, computed, onMounted, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useProjectStore } from '@/stores/projectStore'
  import { useGraphStore } from '@/stores/graphStore'
  import { getV2Manifest, putV2Manifest } from '@/api/projectV2Api'
  import { isElectron, getElectronAPI } from '@/core/utils/electronDetector'
  import type { DataSourceRefV2, ProjectManifestV2 } from '@/types/projectV2'

  const { t } = useI18n()
  const projectStore = useProjectStore()
  const graphStore = useGraphStore()

  const isSaving = ref(false)
  const errorMessage = ref('')
  const successMessage = ref('')
  const originalDataSources = ref<DataSourceRefV2[]>([])
  const dataSources = ref<DataSourceRefV2[]>([])

  const hasChanges = computed(() => {
    return JSON.stringify(dataSources.value) !== JSON.stringify(originalDataSources.value)
  })

  async function loadDataSources(): Promise<void> {
    if (!projectStore.currentPaths?.configPath) {
      return
    }

    try {
      const manifest: ProjectManifestV2 = await getV2Manifest()
      const sources = manifest.data_sources || []
      dataSources.value = JSON.parse(JSON.stringify(sources))
      originalDataSources.value = JSON.parse(JSON.stringify(sources))
      errorMessage.value = ''
      successMessage.value = ''
    } catch (error) {
      logger.error('[DataSourcesSettingsPanel] 加载数据源配置失败:', error)
      errorMessage.value = t('settings.dataSources.loadError')
    }
  }

  function addDataSource(): void {
    const newId = `source_${dataSources.value.length + 1}`
    dataSources.value.push({
      id: newId,
      path: 'data',
      mode: 'relative',
      description: '',
    })
    handleChange()
  }

  function removeDataSource(index: number): void {
    dataSources.value.splice(index, 1)
    handleChange()
  }

  async function selectDirectory(index: number): Promise<void> {
    if (!isElectron()) {
      errorMessage.value = t('settings.dataSources.directorySelectionUnavailable')
      return
    }

    try {
      const api = getElectronAPI()
      if (!api) return

      const result = await api.showOpenDialog({
        title: t('settings.dataSources.selectDirectory'),
        properties: ['openDirectory'],
      })

      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0]
        const configPath = projectStore.currentPaths?.configPath

        if (configPath && selectedPath.startsWith(configPath)) {
          const relativePath = selectedPath.substring(configPath.length).replace(/^[/\\]/, '')
          dataSources.value[index].path = relativePath
          dataSources.value[index].mode = 'relative'
        } else {
          dataSources.value[index].path = selectedPath
          dataSources.value[index].mode = 'absolute'
        }
        handleChange()
      }
    } catch (error) {
      logger.error('[DataSourcesSettingsPanel] 选择目录失败:', error)
      errorMessage.value = t('settings.dataSources.selectError')
    }
  }

  function handleChange(): void {
    errorMessage.value = ''
    successMessage.value = ''
  }

  function handleReset(): void {
    dataSources.value = JSON.parse(JSON.stringify(originalDataSources.value))
    errorMessage.value = ''
    successMessage.value = ''
  }

  async function handleSave(): Promise<void> {
    if (isSaving.value) return
    isSaving.value = true
    errorMessage.value = ''
    successMessage.value = ''

    for (const ds of dataSources.value) {
      if (!ds.id.trim()) {
        errorMessage.value = t('settings.dataSources.errorEmptyId')
        isSaving.value = false
        return
      }
      if (!ds.path.trim()) {
        errorMessage.value = t('settings.dataSources.errorEmptyPath')
        isSaving.value = false
        return
      }
    }

    const ids = dataSources.value.map((ds) => ds.id)
    if (new Set(ids).size !== ids.length) {
      errorMessage.value = t('settings.dataSources.errorDuplicateId')
      isSaving.value = false
      return
    }

    try {
      const manifest: ProjectManifestV2 = await getV2Manifest()
      manifest.data_sources = JSON.parse(JSON.stringify(dataSources.value))
      await putV2Manifest(manifest)
      originalDataSources.value = JSON.parse(JSON.stringify(dataSources.value))
      successMessage.value = t('settings.dataSources.saveSuccess')
      await graphStore.loadProjectFromV2()
    } catch (error) {
      logger.error('[DataSourcesSettingsPanel] 保存失败:', error)
      errorMessage.value = t('settings.dataSources.saveError')
    } finally {
      isSaving.value = false
    }
  }

  onMounted(() => {
    loadDataSources()
  })

  watch(
    () => projectStore.currentPaths?.configPath,
    () => {
      loadDataSources()
    }
  )
</script>

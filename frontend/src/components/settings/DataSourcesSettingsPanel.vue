<!--
  @file DataSourcesSettingsPanel.vue
  @description 数据源设置面板组件

  用于配置和管理项目的数据源，支持添加、编辑和删除数据源。
-->
<template>
  <div class="ui-workbench-page">
    <!-- Panel Header -->
    <div class="settings-panel-header">
      <h2 class="settings-panel-header__title">{{ t('settings.dataSources.title') }}</h2>
      <p class="settings-panel-header__desc">{{ t('settings.dataSources.desc') }}</p>
    </div>

    <!-- Data sources list -->
    <div v-if="dataSources.length > 0" class="ui-workbench-card source-list">
      <div class="source-list__inner">
        <div v-for="(ds, index) in dataSources" :key="ds.id" class="ui-card source-card">
          <div class="source-card__header">
            <span class="ui-badge">#{{ index + 1 }}</span>
            <button
              class="ui-icon-btn ui-icon-btn--danger"
              type="button"
              :disabled="isSaving"
              @click="removeDataSource(index)"
            >
              ×
            </button>
          </div>

          <div class="source-card__body">
            <div class="ui-form-group">
              <label class="ui-form-label">{{ t('settings.dataSources.id') }}</label>
              <input
                v-model="ds.id"
                class="ui-input"
                type="text"
                :placeholder="t('settings.dataSources.idPlaceholder')"
                :disabled="isSaving"
                @change="handleChange"
              />
            </div>

            <div class="ui-form-group">
              <label class="ui-form-label">{{ t('settings.dataSources.path') }}</label>
              <div style="display: flex; gap: var(--ui-space-sm)">
                <input
                  v-model="ds.path"
                  class="ui-input"
                  style="flex: 1"
                  type="text"
                  :placeholder="t('settings.dataSources.pathPlaceholder')"
                  :disabled="isSaving"
                  @change="handleChange"
                />
                <button
                  class="ui-btn ui-btn--secondary ui-btn--sm"
                  type="button"
                  :disabled="isSaving"
                  @click="selectDirectory(index)"
                >
                  {{ t('settings.dataSources.browse') }}
                </button>
              </div>
            </div>

            <div class="ui-form-group">
              <label class="ui-form-label">{{ t('settings.dataSources.mode') }}</label>
              <select
                v-model="ds.mode"
                class="ui-select"
                :disabled="isSaving"
                @change="handleChange"
              >
                <option value="relative">{{ t('settings.dataSources.relative') }}</option>
                <option value="absolute">{{ t('settings.dataSources.absolute') }}</option>
              </select>
            </div>

            <div class="ui-form-group">
              <label class="ui-form-label">{{ t('settings.dataSources.description') }}</label>
              <input
                v-model="ds.description"
                class="ui-input"
                type="text"
                :placeholder="t('settings.dataSources.descPlaceholder')"
                :disabled="isSaving"
                @change="handleChange"
              />
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

    <!-- Add button + Action buttons -->
    <div class="ui-form-actions">
      <button
        class="ui-btn ui-btn--secondary"
        type="button"
        :disabled="isSaving"
        @click="addDataSource"
      >
        + {{ t('settings.dataSources.add') }}
      </button>
      <div style="flex: 1"></div>
      <button class="ui-btn ui-btn--ghost" type="button" :disabled="isSaving" @click="handleReset">
        {{ t('common.reset') }}
      </button>
      <button
        class="ui-btn ui-btn--primary"
        type="button"
        :disabled="isSaving || !hasChanges"
        @click="handleSave"
      >
        {{ isSaving ? t('common.saving') : t('common.save') }}
      </button>
    </div>

    <div v-if="errorMessage" class="settings-error">
      {{ errorMessage }}
    </div>

    <div v-if="successMessage" class="settings-success">
      {{ successMessage }}
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

<style scoped src="./DataSourcesSettingsPanel.styles.css"></style>

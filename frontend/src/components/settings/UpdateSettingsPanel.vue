<!--
  @file UpdateSettingsPanel.vue
  @description 更新设置面板组件

  用于检查应用更新、管理版本信息及配置自动更新行为。
-->
<template>
  <div class="ui-workbench-page">
    <!-- Panel Header -->
    <div class="settings-panel-header">
      <h2 class="settings-panel-header__title">{{ t('settings.update.tab') }}</h2>
      <p class="settings-panel-header__desc">{{ t('settings.update.description') }}</p>
    </div>

    <div class="ui-workbench-card version-card">
      <div class="version-row">
        <span class="version-label">{{ t('settings.update.currentVersion') }}</span>
        <span class="version-value">{{ currentVersion }}</span>
      </div>
      <div v-if="updateState.status !== 'idle'" class="version-row">
        <span class="version-label">{{ t('settings.update.status') }}</span>
        <span
          class="ui-badge"
          :class="{
            'is-primary': updateState.status === 'checking' || updateState.status === 'downloading',
            'is-success':
              updateState.status === 'update-available' || updateState.status === 'downloaded',
            'is-danger': updateState.status === 'error',
          }"
        >
          {{ getStatusText(updateState.status) }}
        </span>
      </div>
    </div>

    <div class="ui-workbench-grid ui-workbench-grid--two preferences-grid">
      <div class="ui-card preference-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('settings.update.autoCheck.label') }}</label>
          <label class="ui-switch">
            <input
              v-model="localConfig.autoCheck"
              class="ui-switch__input"
              type="checkbox"
              @change="handleConfigChange"
            />
            <span class="ui-switch__track"></span>
          </label>
          <p class="settings-desc">{{ t('settings.update.autoCheck.desc') }}</p>
        </div>
      </div>

      <div class="ui-card preference-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('settings.update.autoDownload.label') }}</label>
          <label class="ui-switch">
            <input
              v-model="localConfig.autoDownload"
              class="ui-switch__input"
              type="checkbox"
              @change="handleConfigChange"
            />
            <span class="ui-switch__track"></span>
          </label>
          <p class="settings-desc">{{ t('settings.update.autoDownload.desc') }}</p>
        </div>
      </div>

      <div class="ui-card preference-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('settings.update.sourceType.label') }}</label>
          <select v-model="localConfig.sourceType" class="ui-select" @change="handleConfigChange">
            <option value="local">{{ t('settings.update.sourceType.local') }}</option>
            <option value="github">{{ t('settings.update.sourceType.github') }}</option>
            <option value="custom">{{ t('settings.update.sourceType.custom') }}</option>
          </select>
          <p class="settings-desc">{{ t('settings.update.sourceType.desc') }}</p>
        </div>
      </div>

      <div v-if="localConfig.sourceType === 'custom'" class="ui-card preference-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('settings.update.sourceUrl.label') }}</label>
          <input
            v-model="localConfig.sourceUrl"
            class="ui-input"
            type="text"
            :placeholder="t('settings.update.sourceUrl.placeholder')"
            @blur="handleConfigChange"
          />
          <p class="settings-desc">{{ t('settings.update.sourceUrl.desc') }}</p>
        </div>
      </div>
    </div>

    <div class="ui-workbench-card actions-card">
      <div class="ui-workbench-section__title">{{ t('settings.update.actions') }}</div>
      <div class="update-actions">
        <button
          class="ui-btn ui-btn--primary"
          type="button"
          :disabled="isChecking"
          @click="handleCheckUpdate"
        >
          <span
            v-if="isChecking"
            class="ui-spinner"
            style="width: 16px; height: 16px; border-width: 2px"
          ></span>
          {{ isChecking ? t('settings.update.checking') : t('settings.update.checkNow') }}
        </button>

        <button
          v-if="hasUpdateAvailable()"
          class="ui-btn ui-btn--success"
          type="button"
          :disabled="isDownloading"
          @click="handleDownload"
        >
          <span
            v-if="isDownloading"
            class="ui-spinner"
            style="width: 16px; height: 16px; border-width: 2px"
          ></span>
          {{ isDownloading ? t('settings.update.downloading') : t('settings.update.download') }}
        </button>

        <button
          v-if="isDownloaded()"
          class="ui-btn ui-btn--success"
          type="button"
          @click="handleInstall"
        >
          {{ t('settings.update.install') }}
        </button>
      </div>

      <div v-if="hasUpdateAvailable()" class="ui-card update-info-card">
        <div class="update-available-version">
          {{ t('settings.update.newVersion') }}: {{ updateState.version }}
        </div>
        <div v-if="updateState.releaseDate" class="update-available-date">
          {{ t('settings.update.releaseDate') }}: {{ formatDate(updateState.releaseDate) }}
        </div>
      </div>

      <div v-if="isDownloadingStatus()" class="update-progress">
        <div class="ui-progress">
          <div class="ui-progress__bar" :style="{ width: `${updateState.progress || 0}%` }"></div>
        </div>
        <div class="update-progress-text">
          {{ Math.round(updateState.progress || 0) }}% -
          {{ formatBytes(updateState.transferred || 0) }} /
          {{ formatBytes(updateState.total || 0) }}
        </div>
      </div>

      <div
        v-if="hasError()"
        class="ui-card"
        style="border-left: 3px solid var(--ui-danger); background: rgba(239, 68, 68, 0.08)"
      >
        <div class="update-error-message">{{ updateState.error }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, onMounted, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'

  type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'update-available'
    | 'update-not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'

  interface UpdateState {
    status: string
    version?: string
    releaseDate?: string
    releaseNotes?: string
    progress?: number
    bytesPerSecond?: number
    transferred?: number
    total?: number
    error?: string
  }

  const { t } = useI18n()

  const currentVersion = ref('1.0.0')
  const updateState = ref<UpdateState>({
    status: 'idle',
    version: '',
    releaseDate: '',
    releaseNotes: '',
    progress: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    error: '',
  })

  const localConfig = ref({
    sourceType: 'local' as 'local' | 'github' | 'custom',
    sourceUrl: '',
    autoCheck: true,
    autoDownload: false,
  })

  const isChecking = ref(false)
  const isDownloading = ref(false)

  function hasUpdateAvailable(): boolean {
    return updateState.value.status === 'update-available'
  }

  function isDownloaded(): boolean {
    return updateState.value.status === 'downloaded'
  }

  function isDownloadingStatus(): boolean {
    return updateState.value.status === 'downloading'
  }

  function hasError(): boolean {
    return updateState.value.status === 'error'
  }

  function getStatusText(status: string): string {
    const statusMap: Record<string, string> = {
      idle: 'settings.update.statusIdle',
      checking: 'settings.update.statusChecking',
      'update-available': 'settings.update.statusAvailable',
      'update-not-available': 'settings.update.statusNotAvailable',
      downloading: 'settings.update.statusDownloading',
      downloaded: 'settings.update.statusDownloaded',
      error: 'settings.update.statusError',
    }
    return t(statusMap[status] || 'settings.update.statusIdle')
  }

  function formatDate(dateStr: string): string {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString()
    } catch {
      return dateStr
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  async function loadVersion(): Promise<void> {
    if (window.electronAPI) {
      try {
        currentVersion.value = await window.electronAPI.getAppVersion()
      } catch (error) {
        logger.warn('[UpdateSettings] 获取版本失败:', error)
      }
    }
  }

  async function loadUpdateConfig(): Promise<void> {
    if (window.electronAPI?.update) {
      try {
        const config = await window.electronAPI.update.getConfig()
        localConfig.value = { ...localConfig.value, ...config }
      } catch (error) {
        logger.warn('[UpdateSettings] 获取配置失败:', error)
      }
    }
  }

  async function loadUpdateStatus(): Promise<void> {
    if (window.electronAPI?.update) {
      try {
        const state = await window.electronAPI.update.getStatus()
        updateState.value = state
      } catch (error) {
        logger.warn('[UpdateSettings] 获取状态失败:', error)
      }
    }
  }

  async function handleConfigChange(): Promise<void> {
    if (window.electronAPI?.update) {
      try {
        await window.electronAPI.update.saveConfig(localConfig.value)
      } catch (error) {
        logger.error('[UpdateSettings] 保存配置失败:', error)
      }
    }
  }

  async function handleCheckUpdate(): Promise<void> {
    if (!window.electronAPI) {
      updateState.value = {
        ...updateState.value,
        status: 'error',
        error: '此功能仅在 Electron 桌面应用中可用',
      }
      return
    }

    if (!window.electronAPI.update) {
      updateState.value = {
        ...updateState.value,
        status: 'error',
        error: '更新功能不可用',
      }
      return
    }

    isChecking.value = true
    try {
      const state = await window.electronAPI.update.check()
      updateState.value = state
    } catch (error) {
      updateState.value = {
        status: 'error',
        version: '',
        releaseDate: '',
        releaseNotes: '',
        progress: 0,
        bytesPerSecond: 0,
        transferred: 0,
        total: 0,
        error: String(error),
      }
    } finally {
      isChecking.value = false
    }
  }

  async function handleDownload(): Promise<void> {
    if (!window.electronAPI?.update) return

    isDownloading.value = true
    try {
      const result = await window.electronAPI.update.download()
      if (!result.success) {
        updateState.value = {
          ...updateState.value,
          status: 'error',
          error: result.error,
        }
      }
    } catch (error) {
      logger.error('[UpdateSettings] 下载更新失败:', error)
    } finally {
      isDownloading.value = false
    }
  }

  async function handleInstall(): Promise<void> {
    if (!window.electronAPI?.update) return

    try {
      await window.electronAPI.update.install()
    } catch (error) {
      logger.error('[UpdateSettings] 安装更新失败:', error)
    }
  }

  let statusPollInterval: number | null = null

  onMounted(async () => {
    await loadVersion()
    await loadUpdateConfig()
    await loadUpdateStatus()

    statusPollInterval = window.setInterval(async () => {
      if (updateState.value.status === 'downloading' || updateState.value.status === 'checking') {
        await loadUpdateStatus()
      }
    }, 1000)
  })

  onUnmounted(() => {
    if (statusPollInterval) {
      clearInterval(statusPollInterval)
      statusPollInterval = null
    }
  })
</script>

<style scoped src="./UpdateSettingsPanel.styles.css"></style>

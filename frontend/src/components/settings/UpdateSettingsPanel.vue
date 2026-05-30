<!--
  @file UpdateSettingsPanel.vue
  @description 更新设置面板组件（macOS 风格）

  用于检查应用更新、管理版本信息及配置自动更新行为。
-->

<template>
  <div class="settings-page">
    <!-- 版本信息 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.update.versionInfo') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.update.currentVersion') }}</div>
        <div class="settings-row__desc"></div>
        <div class="settings-row__control">
          <span class="settings-code">{{ currentVersion }}</span>
        </div>
      </div>
      <div v-if="updateState.status !== 'idle'" class="settings-row">
        <div class="settings-row__label">{{ t('settings.update.status') }}</div>
        <div class="settings-row__desc"></div>
        <div class="settings-row__control">
          <span
            class="settings-pill"
            :class="{
              'settings-pill--info': updateState.status === 'checking' || updateState.status === 'downloading',
              'settings-pill--success': updateState.status === 'update-available' || updateState.status === 'downloaded',
              'settings-pill--danger': updateState.status === 'error',
            }"
          >
            {{ getStatusText(updateState.status) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 更新偏好 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.update.preferences') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.update.autoCheck.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.update.autoCheck.desc') }}</div>
        <div class="settings-row__control">
          <label class="settings-switch">
            <input v-model="localConfig.autoCheck" type="checkbox" class="settings-switch__input" @change="handleConfigChange" />
            <span class="settings-switch__track"></span>
          </label>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.update.autoDownload.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.update.autoDownload.desc') }}</div>
        <div class="settings-row__control">
          <label class="settings-switch">
            <input v-model="localConfig.autoDownload" type="checkbox" class="settings-switch__input" @change="handleConfigChange" />
            <span class="settings-switch__track"></span>
          </label>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.update.sourceType.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.update.sourceType.desc') }}</div>
        <div class="settings-row__control">
          <select v-model="localConfig.sourceType" class="settings-select" @change="handleConfigChange">
            <option value="github">{{ t('settings.update.sourceType.github') }}</option>
            <option value="custom">{{ t('settings.update.sourceType.custom') }}</option>
          </select>
        </div>
      </div>
      <div v-if="localConfig.sourceType === 'custom'" class="settings-row">
        <div class="settings-row__label">{{ t('settings.update.sourceUrl.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.update.sourceUrl.desc') }}</div>
        <div class="settings-row__control settings-row__control--wide">
          <input v-model="localConfig.sourceUrl" class="settings-input" type="text" :placeholder="t('settings.update.sourceUrl.placeholder')" @blur="handleConfigChange" />
        </div>
      </div>
    </div>

    <!-- 操作 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.update.actions') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label"></div>
        <div class="settings-row__desc"></div>
        <div class="settings-row__control settings-row__control--wide">
          <button class="ui-btn ui-btn--primary ui-btn--sm" type="button" :disabled="isChecking" @click="handleCheckUpdate">
            <span v-if="isChecking" class="ui-spinner" style="width: 14px; height: 14px; border-width: 2px"></span>
            {{ isChecking ? t('settings.update.checking') : t('settings.update.checkNow') }}
          </button>
          <button
            v-if="hasUpdateAvailable()"
            class="ui-btn ui-btn--success ui-btn--sm"
            type="button"
            :disabled="isDownloading"
            @click="handleDownload"
          >
            <span v-if="isDownloading" class="ui-spinner" style="width: 14px; height: 14px; border-width: 2px"></span>
            {{ isDownloading ? t('settings.update.downloading') : t('settings.update.download') }}
          </button>
          <button v-if="isDownloaded()" class="ui-btn ui-btn--success ui-btn--sm" type="button" @click="handleInstall">
            {{ t('settings.update.install') }}
          </button>
        </div>
      </div>

      <!-- 更新信息 -->
      <div v-if="hasUpdateAvailable()" class="settings-row">
        <div class="settings-row__label">{{ t('settings.update.newVersion') }}</div>
        <div class="settings-row__desc">
          <span v-if="updateState.releaseDate" class="settings-section__desc">
            {{ t('settings.update.releaseDate') }}: {{ formatDate(updateState.releaseDate) }}
          </span>
        </div>
        <div class="settings-row__control">
          <span class="settings-code">{{ updateState.version }}</span>
        </div>
      </div>

      <!-- 下载进度 -->
      <div v-if="isDownloadingStatus()" class="settings-row">
        <div class="settings-row__label">{{ t('settings.update.downloadProgress') }}</div>
        <div class="settings-row__desc">
          {{ Math.round(updateState.progress || 0) }}% - {{ formatBytes(updateState.transferred || 0) }} / {{ formatBytes(updateState.total || 0) }}
        </div>
        <div class="settings-row__control">
          <div class="ui-progress" style="width: 100%">
            <div class="ui-progress__bar" :style="{ width: `${updateState.progress || 0}%` }"></div>
          </div>
        </div>
      </div>

      <!-- 错误信息 -->
      <div v-if="hasError()" class="settings-alert settings-alert--danger">
        <span class="settings-alert__icon">✕</span>
        <div class="settings-alert__content">
          <div class="settings-alert__title">{{ t('settings.update.errorTitle') }}</div>
          <div class="settings-alert__text">{{ updateState.error }}</div>
        </div>
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
    sourceType: 'github' as 'github' | 'custom',
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

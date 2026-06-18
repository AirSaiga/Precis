<!--
  @file ProjectSettingsPanel.vue
  @description 项目设置面板（macOS 风格）

  配置项目级默认运行参数：
  - 严格模式开关
  - 错误处理策略（continue/report/stop）
  - 超时时间
  - 批量校验最大文件数
  - 文件处理（编码、分隔符）
-->

<template>
  <div class="settings-page">
    <!-- 校验参数 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">
          {{ t('settings.project.defaultRunParamsSectionTitle') }}
        </div>
        <div class="settings-section__desc">{{ t('settings.project.defaultRunParamsHint') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.project.strictMode.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.project.strictMode.desc') }}</div>
        <div class="settings-row__control">
          <label class="ui-switch ui-switch--compact">
            <input
              v-model="validationSettings.strict_mode"
              type="checkbox"
              class="ui-switch__input"
              @change="handleValidationChange"
            />
            <span class="ui-switch__track"></span>
          </label>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.project.errorHandling.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.project.errorHandling.desc') }}</div>
        <div class="settings-row__control">
          <select
            v-model="validationSettings.error_handling"
            class="ui-select ui-select--compact"
            @change="handleValidationChange"
          >
            <option value="stop">{{ t('settings.project.errorHandling.stop') }}</option>
            <option value="continue">{{ t('settings.project.errorHandling.continue') }}</option>
            <option value="report">{{ t('settings.project.errorHandling.report') }}</option>
          </select>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.project.timeout.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.project.timeout.desc') }}</div>
        <div class="settings-row__control">
          <input
            v-model.number="validationSettings.timeout_seconds"
            class="ui-input ui-input--compact"
            type="number"
            min="1"
            max="300"
            @change="handleValidationChange"
          />
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.project.batchLimit.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.project.batchLimit.desc') }}</div>
        <div class="settings-row__control">
          <input
            v-model.number="validationSettings.batch_max_files"
            class="ui-input ui-input--compact"
            type="number"
            min="1"
            max="1000"
            @change="handleValidationChange"
          />
        </div>
      </div>
    </div>

    <!-- 文件处理 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">
          {{ t('settings.project.fileProcessingSectionTitle') }}
        </div>
        <div class="settings-section__desc">{{ t('settings.project.fileProcessingHint') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.file.encoding.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.file.encoding.desc') }}</div>
        <div class="settings-row__control">
          <select
            v-model="fileSettings.default_encoding"
            class="ui-select ui-select--compact"
            @change="handleFileChange"
          >
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK</option>
            <option value="auto">{{ t('settings.file.encoding.auto') }}</option>
          </select>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.file.delimiter.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.file.delimiter.desc') }}</div>
        <div class="settings-row__control">
          <select
            v-model="fileSettings.csv_delimiter"
            class="ui-select ui-select--compact"
            @change="handleFileChange"
          >
            <option value=",">{{ t('settings.file.delimiter.comma') }} (,)</option>
            <option value=";">{{ t('settings.file.delimiter.semicolon') }} (;)</option>
            <option value="\t">{{ t('settings.file.delimiter.tab') }} (Tab)</option>
            <option value="custom">{{ t('settings.file.delimiter.custom') }}</option>
          </select>
        </div>
      </div>
      <div v-if="fileSettings.csv_delimiter === 'custom'" class="settings-row">
        <div class="settings-row__label">{{ t('settings.file.delimiter.customLabel') }}</div>
        <div class="settings-row__desc"></div>
        <div class="settings-row__control">
          <input
            v-model="customDelimiter"
            class="ui-input ui-input--compact"
            type="text"
            maxlength="1"
            @change="handleFileChange"
          />
        </div>
      </div>
    </div>

    <div class="settings-actions">
      <button class="ui-btn ui-btn--secondary" type="button" @click="openValidationTaskPanel">
        {{ t('settings.project.openValidationTaskPanel') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, watch, onMounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import {
    useSettingsStore,
    type ValidationSettings,
    type FileProcessingSettings,
  } from '@/stores/settingsStore'
  import { useProjectStore } from '@/stores/projectStore'
  import { useValidationTaskStore } from '@/stores/validationTaskStore'

  const { t } = useI18n()
  const settingsStore = useSettingsStore()
  const projectStore = useProjectStore()
  const validationTaskStore = useValidationTaskStore()

  const validationSettings = ref<ValidationSettings>({
    auto_validate: true,
    strict_mode: false,
    error_handling: 'continue',
    timeout_seconds: 30,
    batch_max_files: 100,
  })

  const fileSettings = ref<FileProcessingSettings>({
    default_encoding: 'utf-8',
    csv_delimiter: ',',
    null_value_strategy: 'null',
    date_format: '%Y-%m-%d',
  })
  const customDelimiter = ref('')

  function openValidationTaskPanel(): void {
    validationTaskStore.openFullProject()
  }

  async function loadSettings(): Promise<void> {
    if (!projectStore.currentPaths?.configPath) {
      return
    }
    try {
      await settingsStore.loadProjectSettings()
      validationSettings.value = { ...settingsStore.projectSettings.validation }
      fileSettings.value = { ...settingsStore.projectSettings.file_processing }
      if (![',', ';', '\t'].includes(fileSettings.value.csv_delimiter)) {
        customDelimiter.value = fileSettings.value.csv_delimiter
        fileSettings.value.csv_delimiter = 'custom'
      }
    } catch (error) {
      logger.warn('[ProjectSettingsPanel] 加载设置失败:', error)
    }
  }

  function handleValidationChange(): void {
    settingsStore.updateValidationSettings(validationSettings.value)
  }

  function handleFileChange(): void {
    const payload = { ...fileSettings.value }
    if (customDelimiter.value && payload.csv_delimiter === 'custom') {
      payload.csv_delimiter = customDelimiter.value
    }
    settingsStore.updateFileProcessingSettings(payload)
  }

  watch(
    () => settingsStore.projectSettings,
    () => {
      validationSettings.value = { ...settingsStore.projectSettings.validation }
      fileSettings.value = { ...settingsStore.projectSettings.file_processing }
      if (![',', ';', '\t'].includes(fileSettings.value.csv_delimiter)) {
        customDelimiter.value = fileSettings.value.csv_delimiter
        fileSettings.value.csv_delimiter = 'custom'
      }
    },
    { deep: true }
  )

  onMounted(() => {
    loadSettings()
  })
</script>

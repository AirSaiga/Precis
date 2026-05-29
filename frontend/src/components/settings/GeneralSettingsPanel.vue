<!--
  @file GeneralSettingsPanel.vue
  @description 通用设置面板（macOS 风格）

  配置应用级通用偏好：
  - 启动时自动加载最近项目
  - 语言设置
  - 主题设置
-->

<template>
  <div class="settings-page">
    <!-- 启动行为 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.general.startup.title') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.general.startup.loadRecent.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.general.startup.loadRecent.desc') }}</div>
        <div class="settings-row__control">
          <label class="settings-switch">
            <input
              v-model="localSettings.loadRecentProjectOnStartup"
              type="checkbox"
              class="settings-switch__input"
              @change="handleChange"
            />
            <span class="settings-switch__track"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- 外观 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.general.appearance.title') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.general.appearance.language.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.general.appearance.language.desc') }}</div>
        <div class="settings-row__control">
          <select v-model="localSettings.language" class="settings-select" @change="handleLanguageChange">
            <option value="zh-CN">{{ t('settings.general.appearance.language.zhCN') }}</option>
            <option value="en-US">{{ t('settings.general.appearance.language.enUS') }}</option>
          </select>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.general.appearance.theme.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.general.appearance.theme.desc') }}</div>
        <div class="settings-row__control">
          <select v-model="localSettings.theme" class="settings-select" @change="handleChange">
            <option value="light">{{ t('settings.general.appearance.theme.light') }}</option>
            <option value="dark">{{ t('settings.general.appearance.theme.dark') }}</option>
            <option value="system">{{ t('settings.general.appearance.theme.system') }}</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from '@/stores/settingsStore'
  import type { GeneralSettings } from '@/stores/settingsStore'

  const { t, locale } = useI18n()
  const settingsStore = useSettingsStore()

  const localSettings = ref<GeneralSettings>({
    loadRecentProjectOnStartup: settingsStore.generalSettings.loadRecentProjectOnStartup,
    language: settingsStore.generalSettings.language,
    theme: settingsStore.generalSettings.theme,
  })

  watch(
    () => settingsStore.generalSettings,
    (newSettings) => {
      localSettings.value = { ...newSettings }
    },
    { deep: true }
  )

  function handleChange(): void {
    settingsStore.updateGeneralSettings(localSettings.value)
  }

  function handleLanguageChange(): void {
    settingsStore.updateGeneralSettings(localSettings.value)
    locale.value = localSettings.value.language
  }
</script>

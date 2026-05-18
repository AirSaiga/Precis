<!--
  @file GeneralSettingsPanel.vue
  @description 通用设置面板

  配置应用级通用偏好：
  - 启动时自动加载最近项目
  - 主题设置（light/dark/system）
-->

<template>
  <div class="ui-workbench-page">
    <!-- Panel Header -->
    <div class="settings-panel-header">
      <h2 class="settings-panel-header__title">{{ t('settings.general.title') }}</h2>
      <p class="settings-panel-header__desc">{{ t('settings.general.description') }}</p>
    </div>

    <div class="ui-workbench-grid ui-workbench-grid--two">
      <div class="ui-workbench-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('settings.general.startup.loadRecent.label') }}</label>
          <p class="settings-desc">{{ t('settings.general.startup.loadRecent.desc') }}</p>
          <label class="ui-switch">
            <input
              v-model="localSettings.loadRecentProjectOnStartup"
              type="checkbox"
              class="ui-switch__input"
              @change="handleChange"
            />
            <span class="ui-switch__track"></span>
          </label>
        </div>
      </div>

      <div class="ui-workbench-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('settings.general.appearance.language.label') }}</label>
          <p class="settings-desc">{{ t('settings.general.appearance.language.desc') }}</p>
          <select
            v-model="localSettings.language"
            class="ui-select ui-select--compact"
            @change="handleLanguageChange"
          >
            <option value="zh-CN">{{ t('settings.general.appearance.language.zhCN') }}</option>
            <option value="en-US">{{ t('settings.general.appearance.language.enUS') }}</option>
          </select>
        </div>
      </div>

      <div class="ui-workbench-card">
        <div class="ui-form-group">
          <label class="ui-form-label">{{ t('settings.general.appearance.theme.label') }}</label>
          <p class="settings-desc">{{ t('settings.general.appearance.theme.desc') }}</p>
          <select
            v-model="localSettings.theme"
            class="ui-select ui-select--compact"
            @change="handleChange"
          >
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

<style scoped src="./GeneralSettingsPanel.styles.css"></style>

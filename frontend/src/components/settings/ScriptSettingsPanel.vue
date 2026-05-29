<!--
  @file ScriptSettingsPanel.vue
  @description 脚本安全设置面板（macOS 风格）

  功能概述：
  - 提供脚本执行的全局启用/禁用开关
  - 配置 eval/exec 函数允许状态
  - 设置沙箱模式和脚本执行超时时间
  - 实时同步到 Settings Store
-->

<template>
  <div class="settings-page">
    <!-- Warning banner -->
    <div class="settings-alert">
      <span class="settings-alert__icon">⚠️</span>
      <div class="settings-alert__content">
        <div class="settings-alert__title">{{ t('settings.script.warning.title') }}</div>
        <div class="settings-alert__text">{{ t('settings.script.warning.text') }}</div>
      </div>
    </div>

    <!-- 功能开关 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.script.enabled.groupTitle') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.script.enabled.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.script.enabled.desc') }}</div>
        <div class="settings-row__control">
          <label class="settings-switch">
            <input v-model="scriptEnabled" type="checkbox" class="settings-switch__input" />
            <span class="settings-switch__track"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- 安全设置 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.script.security.title') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.script.allowEval.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.script.allowEval.desc') }}</div>
        <div class="settings-row__control">
          <label class="settings-switch">
            <input v-model="localSettings.allow_eval" type="checkbox" class="settings-switch__input" />
            <span class="settings-switch__track"></span>
          </label>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.script.allowExec.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.script.allowExec.desc') }}</div>
        <div class="settings-row__control">
          <label class="settings-switch">
            <input v-model="localSettings.allow_exec" type="checkbox" class="settings-switch__input" />
            <span class="settings-switch__track"></span>
          </label>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.script.sandbox.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.script.sandbox.desc') }}</div>
        <div class="settings-row__control">
          <label class="settings-switch">
            <input v-model="localSettings.sandbox_mode" type="checkbox" class="settings-switch__input" />
            <span class="settings-switch__track"></span>
          </label>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row__label">{{ t('settings.script.timeout.label') }}</div>
        <div class="settings-row__desc">{{ t('settings.script.timeout.desc') }}</div>
        <div class="settings-row__control">
          <input
            v-model.number="localSettings.timeout_seconds"
            type="number"
            min="1"
            max="300"
            class="settings-input"
          />
        </div>
      </div>
    </div>

    <div class="settings-section__desc" style="padding: 0 var(--ui-space-sm)">
      {{ t('settings.script.hint') }}
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from '@/stores/settingsStore'
  import type { ScriptSecuritySettings } from '@/stores/settingsStore'

  const { t } = useI18n()
  const settingsStore = useSettingsStore()

  const scriptEnabled = computed({
    get: () => settingsStore.scriptSettings.enabled,
    set: (value: boolean) => {
      if (value) {
        settingsStore.enableScript()
      } else {
        settingsStore.disableScript()
      }
    },
  })

  const localSettings = ref<ScriptSecuritySettings>({
    allow_eval: false,
    allow_exec: false,
    sandbox_mode: true,
    timeout_seconds: 30,
  })

  watch(
    () => settingsStore.projectSettings.script_security,
    (val) => {
      localSettings.value = { ...val }
    },
    { immediate: true, deep: true }
  )

  watch(
    localSettings,
    (val) => {
      settingsStore.updateScriptSecuritySettings({ ...val })
    },
    { deep: true }
  )
</script>

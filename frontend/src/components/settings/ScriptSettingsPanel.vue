<!--
  @file ScriptSettingsPanel.vue
  @description 脚本安全设置面板（允许 eval/exec、沙箱模式、超时等）

  功能概述：
  - 提供脚本执行的全局启用/禁用开关
  - 配置 eval/exec 函数允许状态
  - 设置沙箱模式和脚本执行超时时间
  - 实时同步到 Settings Store

  Props：
  - 无

  Emits：
  - 无
-->
<template>
  <div class="ui-workbench-page">
    <!-- Panel Header -->
    <div class="settings-panel-header">
      <h2 class="settings-panel-header__title">{{ t('settings.script.tab') }}</h2>
      <p class="settings-panel-header__desc">{{ t('settings.script.description') }}</p>
    </div>

    <!-- Warning banner -->
    <div
      class="ui-workbench-card"
      style="background: var(--ui-warning-weak); border-color: var(--ui-warning-ring)"
    >
      <div style="display: flex; gap: var(--ui-space-md)">
        <div style="font-size: 24px">⚠️</div>
        <div>
          <div
            style="
              font-size: var(--ui-font-size-sm);
              font-weight: var(--ui-font-weight-semibold);
              color: var(--ui-warning-strong);
              margin-bottom: 4px;
            "
          >
            {{ t('settings.script.warning.title') }}
          </div>
          <div class="settings-desc" style="color: var(--ui-text-muted)">
            {{ t('settings.script.warning.text') }}
          </div>
        </div>
      </div>
    </div>

    <!-- Capabilities -->
    <div class="ui-workbench-section">
      <div class="ui-workbench-section__header">
        <div class="ui-workbench-section__header-main">
          <div class="ui-workbench-section__title">
            {{ t('settings.script.enabled.groupTitle') }}
          </div>
        </div>
      </div>
      <div class="ui-workbench-grid ui-workbench-grid--two">
        <div class="ui-workbench-card">
          <div class="ui-form-group">
            <label class="ui-form-label">{{ t('settings.script.enabled.label') }}</label>
            <label class="ui-switch">
              <input v-model="scriptEnabled" type="checkbox" class="ui-switch__input" />
              <span class="ui-switch__track"></span>
            </label>
            <p class="settings-desc">{{ t('settings.script.enabled.desc') }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Security -->
    <div class="ui-workbench-section">
      <div class="ui-workbench-section__header">
        <div class="ui-workbench-section__header-main">
          <div class="ui-workbench-section__title">{{ t('settings.script.security.title') }}</div>
        </div>
      </div>
      <div class="ui-workbench-grid ui-workbench-grid--two">
        <div class="ui-workbench-card">
          <div class="ui-form-group">
            <label class="ui-form-label">{{ t('settings.script.allowEval.label') }}</label>
            <label class="ui-switch">
              <input v-model="localSettings.allow_eval" type="checkbox" class="ui-switch__input" />
              <span class="ui-switch__track"></span>
            </label>
            <p class="settings-desc">{{ t('settings.script.allowEval.desc') }}</p>
          </div>
        </div>

        <div class="ui-workbench-card">
          <div class="ui-form-group">
            <label class="ui-form-label">{{ t('settings.script.allowExec.label') }}</label>
            <label class="ui-switch">
              <input v-model="localSettings.allow_exec" type="checkbox" class="ui-switch__input" />
              <span class="ui-switch__track"></span>
            </label>
            <p class="settings-desc">{{ t('settings.script.allowExec.desc') }}</p>
          </div>
        </div>

        <div class="ui-workbench-card">
          <div class="ui-form-group">
            <label class="ui-form-label">{{ t('settings.script.sandbox.label') }}</label>
            <label class="ui-switch">
              <input
                v-model="localSettings.sandbox_mode"
                type="checkbox"
                class="ui-switch__input"
              />
              <span class="ui-switch__track"></span>
            </label>
            <p class="settings-desc">{{ t('settings.script.sandbox.desc') }}</p>
          </div>
        </div>

        <div class="ui-workbench-card">
          <div class="ui-form-group">
            <label class="ui-form-label">{{ t('settings.script.timeout.label') }}</label>
            <input
              v-model.number="localSettings.timeout_seconds"
              type="number"
              min="1"
              max="300"
              class="ui-input"
              style="width: 120px"
            />
            <p class="settings-desc">{{ t('settings.script.timeout.desc') }}</p>
          </div>
        </div>
      </div>
    </div>

    <p class="settings-desc">{{ t('settings.script.hint') }}</p>
  </div>
</template>

<style scoped src="./ScriptSettingsPanel.styles.css"></style>

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

<!--
  @file AIAssistantSettingsPanel.vue
  @description AI 助手设置面板组件

  用于配置 AI 服务提供商、模型选择及相关的助手功能参数。
-->
<template>
  <div class="ui-workbench-page">
    <!-- Panel Header -->
    <div class="settings-panel-header">
      <h2 class="settings-panel-header__title">{{ t('settings.aiAssistant.title') }}</h2>
      <p class="settings-panel-header__desc">{{ t('settings.aiAssistant.description') }}</p>
    </div>

    <!-- Current Provider Status -->
    <div v-if="activeProvider" class="ui-workbench-card">
      <div class="ui-workbench-section__header">
        <div class="ui-workbench-section__header-main">
          <div class="ui-workbench-section__title">{{ activeProvider.name }}</div>
          <div class="ui-workbench-section__desc">{{ activeProvider.model }}</div>
        </div>
        <span class="ui-badge is-primary">{{ t('settings.aiAssistant.currentModel') }}</span>
      </div>
      <div class="provider-detail">
        <div class="provider-detail__row">
          <span class="provider-detail__label">ID:</span>
          <span class="provider-detail__value">{{ activeProvider.id }}</span>
        </div>
        <div class="provider-detail__row">
          <span class="provider-detail__label">Base URL:</span>
          <span class="provider-detail__value">{{ activeProvider.base_url }}</span>
        </div>
        <div class="provider-detail__row">
          <span class="provider-detail__label">Type:</span>
          <span class="provider-detail__value">{{ activeProvider.provider }}</span>
        </div>
        <div class="provider-detail__row">
          <span class="provider-detail__label">API Key:</span>
          <span class="provider-detail__value">{{
            activeProvider.is_configured
              ? '✓ ' + t('settings.aiAssistant.configured')
              : '✗ ' + t('settings.aiAssistant.noApiKey')
          }}</span>
        </div>
      </div>
    </div>

    <!-- No Provider Warning -->
    <div v-else class="ui-workbench-card is-warning">
      <div class="ui-workbench-section__header">
        <div class="ui-workbench-section__header-main">
          <div class="ui-workbench-section__title">{{ t('settings.aiAssistant.noProvider') }}</div>
        </div>
      </div>
      <p class="settings-desc">{{ t('settings.aiAssistant.noProviderHint') }}</p>
    </div>

    <!-- Help Documentation -->
    <div class="ui-workbench-card help-card">
      <div class="ui-workbench-section__header">
        <div class="ui-workbench-section__header-main">
          <div class="ui-workbench-section__title">{{ t('settings.aiAssistant.helpTitle') }}</div>
        </div>
      </div>

      <div class="help-content">
        <p class="help-intro">{{ t('settings.aiAssistant.helpIntro') }}</p>

        <!-- Step 1: Create config file -->
        <div class="help-step">
          <h4 class="help-step__title">{{ t('settings.aiAssistant.helpStep1Title') }}</h4>
          <p class="help-step__desc">{{ t('settings.aiAssistant.helpStep1Desc') }}</p>
          <ul class="help-step__list">
            <li>
              <code class="help-code">{{
                t('settings.aiAssistant.helpStep1Project', {
                  path: configPath || '~/.precis/ai_providers.yaml',
                })
              }}</code>
            </li>
            <li>
              <code class="help-code">{{
                t('settings.aiAssistant.helpStep1User', { path: '~/.precis/ai_providers.yaml' })
              }}</code>
            </li>
            <li>
              <code class="help-code">{{ t('settings.aiAssistant.helpStep1System') }}</code>
            </li>
          </ul>
        </div>

        <!-- Step 2: Fill in config -->
        <div class="help-step">
          <h4 class="help-step__title">{{ t('settings.aiAssistant.helpStep2Title') }}</h4>
          <p class="help-step__desc">{{ t('settings.aiAssistant.helpStep2Desc') }}</p>
          <div class="help-fields">
            <div class="help-field">
              <span class="help-field__name">id</span>
              <span class="help-field__desc">— {{ t('settings.aiAssistant.fieldId') }}</span>
            </div>
            <div class="help-field">
              <span class="help-field__name">name</span>
              <span class="help-field__desc">— {{ t('settings.aiAssistant.fieldName') }}</span>
            </div>
            <div class="help-field">
              <span class="help-field__name">type</span>
              <span class="help-field__desc">— {{ t('settings.aiAssistant.fieldType') }}</span>
            </div>
            <div class="help-field">
              <span class="help-field__name">base_url</span>
              <span class="help-field__desc">— {{ t('settings.aiAssistant.fieldBaseUrl') }}</span>
            </div>
            <div class="help-field">
              <span class="help-field__name">api_key</span>
              <span class="help-field__desc">— {{ t('settings.aiAssistant.fieldApiKey') }}</span>
            </div>
            <div class="help-field">
              <span class="help-field__name">model</span>
              <span class="help-field__desc">— {{ t('settings.aiAssistant.fieldModel') }}</span>
            </div>
            <div class="help-field">
              <span class="help-field__name">defaults.chat</span>
              <span class="help-field__desc">— {{ t('settings.aiAssistant.fieldDefaults') }}</span>
            </div>
          </div>
        </div>

        <!-- Step 3: Supported types -->
        <div class="help-step">
          <h4 class="help-step__title">{{ t('settings.aiAssistant.helpStep3Title') }}</h4>
          <p class="help-step__desc">{{ t('settings.aiAssistant.helpStep3Desc') }}</p>
          <p class="help-step__highlight">{{ t('settings.aiAssistant.helpStep3Types') }}</p>
        </div>

        <!-- Step 4: Env vars -->
        <div class="help-step">
          <h4 class="help-step__title">{{ t('settings.aiAssistant.helpStep4Title') }}</h4>
          <p class="help-step__desc">{{ t('settings.aiAssistant.helpStep4Desc') }}</p>
          <div class="help-tip">
            <span class="help-tip__icon">💡</span>
            <code class="help-code">api_key: ${OPENAI_API_KEY}</code>
          </div>
        </div>

        <!-- Step 5: Ollama -->
        <div class="help-step">
          <h4 class="help-step__title">{{ t('settings.aiAssistant.helpStep5Title') }}</h4>
          <p class="help-step__desc">{{ t('settings.aiAssistant.helpStep5Desc') }}</p>
        </div>

        <!-- Step 6: Apply changes -->
        <div class="help-step">
          <h4 class="help-step__title">{{ t('settings.aiAssistant.helpStep6Title') }}</h4>
          <p class="help-step__desc">{{ t('settings.aiAssistant.helpStep6Desc') }}</p>
          <div class="help-tip is-warning">
            <span class="help-tip__icon">⚠️</span>
            <span>{{ t('settings.aiAssistant.restartRequired') }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Config File Info -->
    <div class="ui-workbench-section">
      <div class="ui-workbench-section__header">
        <div class="ui-workbench-section__header-main">
          <div class="ui-workbench-section__title">{{ t('settings.aiAssistant.configPath') }}</div>
        </div>
      </div>
      <div class="config-file-section">
        <code class="config-file-path">{{ configPath || '~/.precis/ai_providers.yaml' }}</code>
        <button
          v-if="isElectronEnv"
          class="ui-btn ui-btn--secondary ui-btn--sm"
          type="button"
          @click="openConfigFile"
        >
          {{ t('settings.aiAssistant.openConfigFile') }}
        </button>
      </div>
    </div>

    <!-- Config Template -->
    <div class="ui-workbench-section">
      <div class="ui-workbench-section__header">
        <div class="ui-workbench-section__header-main">
          <div class="ui-workbench-section__title">
            {{ t('settings.aiAssistant.configTemplate') }}
          </div>
        </div>
      </div>
      <pre class="config-template">{{ configTemplate }}</pre>
      <button class="ui-btn ui-btn--secondary ui-btn--sm" type="button" @click="copyTemplate">
        {{ copied ? t('common.copied') : t('common.copy') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { onMounted, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { CloudAIProviderResponse } from '@/types/ai'
  import {
    getCloudAIProviders,
    getActiveCloudAIProvider,
    getCloudAIProviderConfigInfo,
  } from '@/api/aiApi'

  const { t } = useI18n()

  const providers = ref<CloudAIProviderResponse[]>([])
  const activeProvider = ref<CloudAIProviderResponse | null>(null)
  const configPath = ref('')
  const copied = ref(false)
  const isElectronEnv = ref(!!window.electronAPI)

  const configTemplate = `# Precis AI Provider 配置文件
# 复制到 ~/.precis/ai_providers.yaml 并修改

version: "2.0"

providers:
  # OpenAI（或兼容 API）
  - id: openai
    name: OpenAI
    type: openai
    base_url: https://api.openai.com/v1
    api_key: \${OPENAI_API_KEY}
    model: gpt-4o

  # 本地 Ollama（无需 API Key）
  - id: ollama-local
    name: Ollama Local
    type: ollama
    base_url: http://localhost:11434
    api_key: null
    model: llama3.2

defaults:
  chat: openai`

  async function loadProviders(): Promise<void> {
    try {
      const [allProviders, active] = await Promise.all([
        getCloudAIProviders(),
        getActiveCloudAIProvider(),
      ])
      providers.value = allProviders
      activeProvider.value = active
    } catch (error) {
      logger.error('[AIAssistantSettings] Failed to load providers:', error)
    }
  }

  async function loadConfigInfo(): Promise<void> {
    try {
      const info = await getCloudAIProviderConfigInfo()
      if (info?.path) {
        configPath.value = info.path
      }
    } catch (error) {
      logger.error('[AIAssistantSettings] Failed to load config info:', error)
    }
  }

  async function openConfigFile(): Promise<void> {
    const path = configPath.value || '~/.precis/ai_providers.yaml'
    try {
      if (window.electronAPI?.openFile) {
        await window.electronAPI.openFile(path)
      }
    } catch (error) {
      logger.error('[AIAssistantSettings] Failed to open config file:', error)
    }
  }

  async function copyTemplate(): Promise<void> {
    try {
      await navigator.clipboard.writeText(configTemplate)
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 2000)
    } catch (error) {
      logger.error('[AIAssistantSettings] Failed to copy template:', error)
    }
  }

  onMounted(() => {
    loadProviders()
    loadConfigInfo()
  })
</script>

<style scoped src="./AIAssistantSettingsPanel.styles.css"></style>

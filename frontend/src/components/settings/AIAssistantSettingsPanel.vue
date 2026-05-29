<!--
  @file AIAssistantSettingsPanel.vue
  @description AI 助手设置面板组件（macOS 风格）

  用于配置 AI 服务提供商、模型选择及相关的助手功能参数。
-->

<template>
  <div class="settings-page">
    <!-- 当前配置 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.aiAssistant.currentConfig') }}</div>
      </div>
      <div v-if="activeProvider" class="settings-list">
        <div class="settings-list__item">
          <div class="settings-row__label" style="width: 80px; flex-shrink: 0">ID</div>
          <div class="settings-row__desc">{{ activeProvider.id }}</div>
        </div>
        <div class="settings-list__item">
          <div class="settings-row__label" style="width: 80px; flex-shrink: 0">{{ t('settings.aiAssistant.providerName') }}</div>
          <div class="settings-row__desc">{{ activeProvider.name }}</div>
        </div>
        <div class="settings-list__item">
          <div class="settings-row__label" style="width: 80px; flex-shrink: 0">{{ t('settings.aiAssistant.model') }}</div>
          <div class="settings-row__desc">{{ activeProvider.model }}</div>
        </div>
        <div class="settings-list__item">
          <div class="settings-row__label" style="width: 80px; flex-shrink: 0">Base URL</div>
          <div class="settings-row__desc">{{ activeProvider.base_url }}</div>
        </div>
        <div class="settings-list__item">
          <div class="settings-row__label" style="width: 80px; flex-shrink: 0">API Key</div>
          <div class="settings-row__control">
            <span
              class="settings-pill"
              :class="activeProvider.is_configured ? 'settings-pill--success' : 'settings-pill--warning'"
            >
              {{ activeProvider.is_configured ? '✓ ' + t('settings.aiAssistant.configured') : '✗ ' + t('settings.aiAssistant.noApiKey') }}
            </span>
          </div>
        </div>
      </div>
      <div v-else class="settings-alert settings-alert--warning">
        <span class="settings-alert__icon">⚠️</span>
        <div class="settings-alert__content">
          <div class="settings-alert__title">{{ t('settings.aiAssistant.noProvider') }}</div>
          <div class="settings-alert__text">{{ t('settings.aiAssistant.noProviderHint') }}</div>
        </div>
      </div>
    </div>

    <!-- 配置文件 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.aiAssistant.configPath') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__desc">
          <span class="settings-code">{{ configPath || '~/.precis/ai_providers.yaml' }}</span>
        </div>
        <div class="settings-row__control">
          <button v-if="isElectronEnv" class="ui-btn ui-btn--secondary ui-btn--sm" type="button" @click="openConfigFile">
            {{ t('settings.aiAssistant.openConfigFile') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 配置模板 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.aiAssistant.configTemplate') }}</div>
      </div>
      <div class="settings-row">
        <div class="settings-row__desc settings-row__control--full">
          <pre class="config-template">{{ configTemplate }}</pre>
        </div>
        <div class="settings-row__control">
          <button class="ui-btn ui-btn--secondary ui-btn--sm" type="button" @click="copyTemplate">
            {{ copied ? t('common.copied') : t('common.copy') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 使用说明（可折叠） -->
    <div class="settings-section">
      <div class="settings-section__header" style="cursor: pointer" @click="showHelp = !showHelp">
        <div class="settings-section__title">
          {{ t('settings.aiAssistant.helpTitle') }}
          <span style="margin-left: var(--ui-space-sm); font-size: var(--ui-font-size-xs); color: var(--ui-text-muted)">
            {{ showHelp ? t('common.collapse') : t('common.expand') }}
          </span>
        </div>
      </div>
      <div v-show="showHelp" class="settings-list">
        <div class="settings-list__item" style="flex-direction: column; align-items: stretch; gap: var(--ui-space-sm)">
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.aiAssistant.helpStep1Title') }}</div>
            <div class="settings-row__desc">{{ t('settings.aiAssistant.helpStep1Desc') }}</div>
          </div>
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.aiAssistant.helpStep2Title') }}</div>
            <div class="settings-row__desc">{{ t('settings.aiAssistant.helpStep2Desc') }}</div>
          </div>
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.aiAssistant.helpStep3Title') }}</div>
            <div class="settings-row__desc">{{ t('settings.aiAssistant.helpStep3Desc') }}</div>
          </div>
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.aiAssistant.helpStep4Title') }}</div>
            <div class="settings-row__desc">{{ t('settings.aiAssistant.helpStep4Desc') }}</div>
          </div>
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.aiAssistant.helpStep5Title') }}</div>
            <div class="settings-row__desc">{{ t('settings.aiAssistant.helpStep5Desc') }}</div>
          </div>
          <div class="settings-row" style="padding: 0">
            <div class="settings-row__label">{{ t('settings.aiAssistant.helpStep6Title') }}</div>
            <div class="settings-row__desc">{{ t('settings.aiAssistant.helpStep6Desc') }}</div>
          </div>
        </div>
      </div>
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
  const showHelp = ref(false)

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

<style scoped>
  .config-template {
    font-family: var(--ui-font-family-mono, monospace);
    font-size: 11px;
    line-height: 1.5;
    background: var(--ui-bg-subtle);
    padding: var(--ui-space-md);
    border-radius: var(--ui-radius-md);
    border: 1px solid var(--ui-border-light);
    overflow-x: auto;
    white-space: pre;
    margin: 0;
    width: 100%;
  }
</style>

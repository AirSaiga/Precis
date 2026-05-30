<!--
  @file AIAssistantSettingsPanel.vue
  @description AI 助手设置面板组件（支持多 Provider 管理）

  功能：
  - 显示所有已配置的 Provider 列表
  - 标记当前活跃 Provider
  - 支持切换默认 Provider
  - 支持对每个 Provider 做连接测试
  - 显示连接状态（健康、延迟、可用模型）
-->

<template>
  <div class="settings-page">
    <!-- Provider 列表 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.aiAssistant.providerList') }}</div>
        <div class="settings-section__subtitle">{{ t('settings.aiAssistant.providerListHint') }}</div>
      </div>

      <div v-if="providers.length === 0" class="settings-alert settings-alert--warning">
        <span class="settings-alert__icon">⚠️</span>
        <div class="settings-alert__content">
          <div class="settings-alert__title">{{ t('settings.aiAssistant.noProvider') }}</div>
          <div class="settings-alert__text">{{ t('settings.aiAssistant.noProviderHint') }}</div>
        </div>
      </div>

      <div v-else class="provider-list">
        <div
          v-for="p in providers"
          :key="p.id"
          class="provider-card"
          :class="{ 'provider-card--active': p.id === activeProviderId }"
        >
          <div class="provider-card__header">
            <div class="provider-card__info">
              <div class="provider-card__name">
                {{ p.name }}
                <span
                  v-if="p.id === activeProviderId"
                  class="provider-card__badge provider-card__badge--active"
                >
                  {{ t('settings.aiAssistant.active') }}
                </span>
              </div>
              <div class="provider-card__meta">
                {{ p.provider }} · {{ p.model }}
              </div>
            </div>
            <div class="provider-card__actions">
              <button
                class="ui-btn ui-btn--secondary ui-btn--sm"
                :disabled="testingProvider === p.id"
                @click="testProvider(p.id)"
              >
                <span v-if="testingProvider === p.id">{{ t('settings.aiAssistant.testing') }}...</span>
                <span v-else>{{ t('settings.aiAssistant.testConnection') }}</span>
              </button>
              <button
                v-if="p.id !== activeProviderId"
                class="ui-btn ui-btn--primary ui-btn--sm"
                :disabled="activatingProvider === p.id"
                @click="activateProvider(p.id)"
              >
                {{ t('settings.aiAssistant.setActive') }}
              </button>
            </div>
          </div>

          <div class="provider-card__details">
            <div class="provider-card__detail-row">
              <span class="provider-card__label">ID</span>
              <span class="provider-card__value">{{ p.id }}</span>
            </div>
            <div class="provider-card__detail-row">
              <span class="provider-card__label">Base URL</span>
              <span class="provider-card__value">{{ p.base_url }}</span>
            </div>
            <div class="provider-card__detail-row">
              <span class="provider-card__label">{{ t('settings.aiAssistant.configStatus') }}</span>
              <span
                class="settings-pill"
                :class="p.is_configured ? 'settings-pill--success' : 'settings-pill--warning'"
              >
                {{ p.is_configured ? '✓ ' + t('settings.aiAssistant.configured') : '✗ ' + t('settings.aiAssistant.noApiKey') }}
              </span>
            </div>
          </div>

          <!-- 连接测试结果 -->
          <div v-if="testResults[p.id]" class="provider-card__test-result">
            <div
              class="provider-card__test-status"
              :class="testResults[p.id].health.status === 'ok' ? 'test-status--ok' : 'test-status--error'"
            >
              <span class="test-status__icon">{{ testResults[p.id].health.status === 'ok' ? '✓' : '✗' }}</span>
              <span class="test-status__text">
                {{ testResults[p.id].health.status === 'ok'
                  ? t('settings.aiAssistant.testSuccess', { latency: testResults[p.id].health.latency_ms })
                  : t('settings.aiAssistant.testFailed', { error: testResults[p.id].health.error })
                }}
              </span>
            </div>
            <div v-if="testResults[p.id].available_models?.length" class="provider-card__models">
              <div class="provider-card__models-label">{{ t('settings.aiAssistant.availableModels') }}:</div>
              <div class="provider-card__models-list">
                <span
                  v-for="model in testResults[p.id].available_models.slice(0, 5)"
                  :key="model"
                  class="provider-card__model-tag"
                >
                  {{ model }}
                </span>
                <span v-if="testResults[p.id].available_models.length > 5" class="provider-card__model-tag">
                  +{{ testResults[p.id].available_models.length - 5 }}
                </span>
              </div>
            </div>
          </div>
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
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed, onMounted, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { CloudAIProviderResponse } from '@/types/ai'
  import {
    getCloudAIProviders,
    getActiveCloudAIProvider,
    getCloudAIProviderConfigInfo,
    testCloudAIProvider,
    activateCloudAIProvider,
  } from '@/api/aiApi'
  import { useToast } from '@/composables/shared'

  const { t } = useI18n()
  const { success: showSuccess, error: showError } = useToast()

  const providers = ref<CloudAIProviderResponse[]>([])
  const activeProviderId = ref<string | null>(null)
  const configPath = ref('')
  const copied = ref(false)
  const isElectronEnv = ref(!!window.electronAPI)

  // 测试状态
  const testingProvider = ref<string | null>(null)
  const testResults = ref<
    Record<
      string,
      {
        provider_id: string
        health: { status: string; latency_ms?: number; error?: string }
        available_models: string[]
      }
    >
  >({})

  // 激活状态
  const activatingProvider = ref<string | null>(null)

  const configTemplate = computed(
    () => `# ${t('settings.aiAssistant.configTemplateHeader')}
# ${t('settings.aiAssistant.configTemplateHint')}

version: "2.0"

providers:
  # ${t('settings.aiAssistant.configTemplateOpenAI')}
  - id: openai
    name: OpenAI
    type: openai
    base_url: https://api.openai.com/v1
    api_key: \${OPENAI_API_KEY}
    model: gpt-4o

  # ${t('settings.aiAssistant.configTemplateOllama')}
  - id: ollama-local
    name: Ollama Local
    type: ollama
    base_url: http://localhost:11434
    api_key: null
    model: llama3.2

defaults:
  chat: openai`
  )

  async function loadProviders(): Promise<void> {
    try {
      const [allProviders, active] = await Promise.all([
        getCloudAIProviders(),
        getActiveCloudAIProvider(),
      ])
      providers.value = allProviders
      activeProviderId.value = active?.id || null
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

  async function testProvider(providerId: string): Promise<void> {
    testingProvider.value = providerId
    try {
      const result = await testCloudAIProvider(providerId)
      testResults.value[providerId] = result
      if (result.health.status === 'ok') {
        showSuccess(t('settings.aiAssistant.testSuccessTitle'), t('settings.aiAssistant.testSuccessDesc'))
      } else {
        showError(t('settings.aiAssistant.testFailedTitle'), result.health.error || t('settings.aiAssistant.testFailedUnknown'))
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showError(t('settings.aiAssistant.testFailedTitle'), msg)
      testResults.value[providerId] = {
        provider_id: providerId,
        health: { status: 'error', error: msg },
        available_models: [],
      }
    } finally {
      testingProvider.value = null
    }
  }

  async function activateProvider(providerId: string): Promise<void> {
    activatingProvider.value = providerId
    try {
      await activateCloudAIProvider(providerId)
      activeProviderId.value = providerId
      showSuccess(t('settings.aiAssistant.activateSuccessTitle'), t('settings.aiAssistant.activateSuccessDesc'))
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showError(t('settings.aiAssistant.activateFailedTitle'), msg)
    } finally {
      activatingProvider.value = null
    }
  }

  async function openConfigFile(): Promise<void> {
    const path = configPath.value || '~/.precis/ai_providers.yaml'
    try {
      if (window.electronAPI?.openFile) {
        const result = await window.electronAPI.openFile(path)
        if (!result?.success) {
          showError(t('settings.aiAssistant.openConfigFileFailed'))
        }
      }
    } catch (error) {
      logger.error('[AIAssistantSettings] Failed to open config file:', error)
      showError(t('settings.aiAssistant.openConfigFileFailed'))
    }
  }

  async function copyTemplate(): Promise<void> {
    try {
      await navigator.clipboard.writeText(configTemplate.value)
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
  .provider-list {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-md);
  }

  .provider-card {
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-lg);
    padding: var(--ui-space-md);
    transition: all 0.2s ease;
  }

  .provider-card--active {
    border-color: var(--ui-color-primary);
    box-shadow: 0 0 0 1px var(--ui-color-primary);
  }

  .provider-card__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--ui-space-sm);
  }

  .provider-card__info {
    flex: 1;
  }

  .provider-card__name {
    font-weight: 600;
    font-size: var(--ui-font-size-md);
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
  }

  .provider-card__badge {
    font-size: var(--ui-font-size-xs);
    padding: 2px 8px;
    border-radius: var(--ui-radius-sm);
    font-weight: 500;
  }

  .provider-card__badge--active {
    background: var(--ui-color-primary-light);
    color: var(--ui-color-primary);
  }

  .provider-card__meta {
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-muted);
    margin-top: 2px;
  }

  .provider-card__actions {
    display: flex;
    gap: var(--ui-space-sm);
    flex-shrink: 0;
  }

  .provider-card__details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: var(--ui-space-sm);
  }

  .provider-card__detail-row {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    font-size: var(--ui-font-size-sm);
  }

  .provider-card__label {
    color: var(--ui-text-muted);
    width: 80px;
    flex-shrink: 0;
  }

  .provider-card__value {
    color: var(--ui-text-secondary);
    word-break: break-all;
  }

  .provider-card__test-result {
    margin-top: var(--ui-space-sm);
    padding-top: var(--ui-space-sm);
    border-top: 1px solid var(--ui-border-light);
  }

  .provider-card__test-status {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    font-size: var(--ui-font-size-sm);
    margin-bottom: var(--ui-space-xs);
  }

  .test-status--ok {
    color: var(--ui-color-success);
  }

  .test-status--error {
    color: var(--ui-color-error);
  }

  .test-status__icon {
    font-weight: 600;
  }

  .provider-card__models {
    margin-top: var(--ui-space-xs);
  }

  .provider-card__models-label {
    font-size: var(--ui-font-size-xs);
    color: var(--ui-text-muted);
    margin-bottom: 4px;
  }

  .provider-card__models-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .provider-card__model-tag {
    font-size: var(--ui-font-size-xs);
    padding: 2px 8px;
    background: var(--ui-bg-subtle);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-secondary);
  }

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

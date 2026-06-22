<!--
  @file AIAssistantSettingsPanel.vue
  @description AI 助手设置面板组件（重构版）

  功能：
  - 展示已配置的 Provider 列表（卡片形式）
  - 添加新 Provider（选择服务商预设 → 填 API Key → 选模型）
  - 编辑已有 Provider（内联编辑 API Key / 模型 / 名称）
  - 删除 Provider（带确认）
  - 测试连接 / 切换活跃 Provider
  - 底部折叠式"高级"区域：配置文件路径、打开文件、复制模板
-->

<template>
  <div class="settings-page">
    <!-- Provider 列表 -->
    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">{{ t('settings.aiAssistant.providerList') }}</div>
        <div class="settings-section__subtitle">
          {{ t('settings.aiAssistant.providerListHint') }}
        </div>
      </div>

      <!-- 无 Provider 提示 -->
      <div v-if="providers.length === 0 && !showAddForm" class="provider-empty">
        <div class="provider-empty__icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <div class="provider-empty__title">{{ t('settings.aiAssistant.noProvider') }}</div>
        <div class="provider-empty__text">{{ t('settings.aiAssistant.noProviderDesc') }}</div>
        <button class="ui-btn ui-btn--primary ui-btn--sm" type="button" @click="openAddForm">
          + {{ t('settings.aiAssistant.addProvider') }}
        </button>
      </div>

      <!-- Provider 卡片列表 -->
      <div v-if="providers.length > 0" class="provider-list">
        <div
          v-for="p in providers"
          :key="p.id"
          class="provider-card"
          :class="{ 'provider-card--active': p.id === activeProviderId }"
        >
          <!-- 编辑模式 -->
          <template v-if="editingId === p.id">
            <div class="provider-card__header">
              <div class="provider-card__info">
                <div class="provider-card__name">
                  {{ t('settings.aiAssistant.edit') }}: {{ editForm.name }}
                </div>
              </div>
            </div>
            <div class="provider-card__edit-form">
              <div class="edit-row">
                <label class="edit-label">{{ t('settings.aiAssistant.providerName') }}</label>
                <input v-model="editForm.name" class="ui-input ui-input--compact" type="text" />
              </div>
              <div class="edit-row">
                <label class="edit-label">{{ t('settings.aiAssistant.apiKey') }}</label>
                <input
                  v-model="editForm.apiKey"
                  class="ui-input ui-input--compact"
                  type="password"
                  :placeholder="t('settings.aiAssistant.apiKeyPlaceholder')"
                />
              </div>
              <div class="edit-row">
                <label class="edit-label">{{ t('settings.aiAssistant.model') }}</label>
                <select v-model="editForm.model" class="ui-select ui-select--compact">
                  <option v-for="m in presetModels(p)" :key="m" :value="m">{{ m }}</option>
                  <option v-if="!presetModels(p).includes(editForm.model)" :value="editForm.model">
                    {{ editForm.model }}
                  </option>
                </select>
              </div>
              <div class="edit-row">
                <label class="edit-label">{{ t('settings.aiAssistant.contextWindow') }}</label>
                <input
                  v-model="editForm.contextWindow"
                  class="ui-input ui-input--compact"
                  type="number"
                  min="1024"
                  step="1024"
                  :placeholder="t('settings.aiAssistant.contextWindowPlaceholder')"
                />
              </div>
            </div>
            <div class="provider-card__actions">
              <button
                class="ui-btn ui-btn--secondary ui-btn--sm"
                :disabled="actionLoading"
                @click="cancelEdit"
              >
                {{ t('settings.aiAssistant.cancel') }}
              </button>
              <button
                class="ui-btn ui-btn--primary ui-btn--sm"
                :disabled="actionLoading"
                @click="handleUpdate(p.id)"
              >
                <span v-if="actionLoading" class="spinner-sm"></span>
                {{ t('settings.aiAssistant.save') }}
              </button>
            </div>
          </template>

          <!-- 展示模式 -->
          <template v-else>
            <div class="provider-card__header">
              <div class="provider-card__icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
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
                <div class="provider-card__meta">{{ p.model }}</div>
              </div>
              <div class="provider-card__status">
                <span
                  class="settings-pill"
                  :class="p.is_configured ? 'settings-pill--success' : 'settings-pill--warning'"
                >
                  {{
                    p.is_configured
                      ? t('settings.aiAssistant.configured')
                      : t('settings.aiAssistant.noApiKey')
                  }}
                </span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="provider-card__actions">
              <button
                class="ui-btn ui-btn--secondary ui-btn--sm"
                :disabled="testingProvider === p.id"
                @click="testProvider(p.id)"
              >
                <span v-if="testingProvider === p.id"
                  >{{ t('settings.aiAssistant.testing') }}...</span
                >
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
              <button class="ui-btn ui-btn--ghost ui-btn--sm" @click="startEdit(p)">
                {{ t('settings.aiAssistant.edit') }}
              </button>
              <button
                class="ui-btn ui-btn--ghost ui-btn--sm ui-btn--danger-text"
                @click="handleDelete(p.id, p.name)"
              >
                {{ t('settings.aiAssistant.delete') }}
              </button>
            </div>

            <!-- 测试结果 -->
            <div v-if="testResults[p.id]" class="provider-card__test-result">
              <div
                class="provider-card__test-status"
                :class="
                  testResults[p.id]?.health.status === 'ok'
                    ? 'test-status--ok'
                    : 'test-status--error'
                "
              >
                <span class="test-status__icon">{{
                  testResults[p.id]?.health.status === 'ok' ? '✓' : '✗'
                }}</span>
                <span class="test-status__text">
                  {{
                    testResults[p.id]?.health.status === 'ok'
                      ? t('settings.aiAssistant.testSuccess', {
                          latency: testResults[p.id]?.health.latency_ms,
                        })
                      : t('settings.aiAssistant.testFailed', {
                          error: testResults[p.id]?.health.error,
                        })
                  }}
                </span>
              </div>
              <div v-if="testResults[p.id]?.available_models?.length" class="provider-card__models">
                <div class="provider-card__models-label">
                  {{ t('settings.aiAssistant.availableModels') }}:
                </div>
                <div class="provider-card__models-list">
                  <span
                    v-for="model in testResults[p.id]?.available_models?.slice(0, 5) ?? []"
                    :key="model"
                    class="provider-card__model-tag"
                  >
                    {{ model }}
                  </span>
                  <span
                    v-if="(testResults[p.id]?.available_models?.length ?? 0) > 5"
                    class="provider-card__model-tag"
                  >
                    +{{ (testResults[p.id]?.available_models?.length ?? 0) - 5 }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 添加按钮 -->
      <div class="settings-actions" v-if="providers.length > 0 && !showAddForm">
        <button class="ui-btn ui-btn--secondary ui-btn--sm" type="button" @click="openAddForm">
          + {{ t('settings.aiAssistant.addProvider') }}
        </button>
      </div>

      <!-- 添加表单 -->
      <div v-if="showAddForm" class="provider-card provider-card--add">
        <div class="provider-card__header">
          <div class="provider-card__icon provider-card__icon--accent">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </div>
          <div class="provider-card__info">
            <div class="provider-card__name">{{ t('settings.aiAssistant.addProvider') }}</div>
            <div class="provider-card__meta">DeepSeek</div>
          </div>
        </div>
        <div class="provider-card__edit-form">
          <div class="edit-row">
            <label class="edit-label">{{ t('settings.aiAssistant.apiKey') }}</label>
            <input
              v-model="addForm.apiKey"
              class="ui-input ui-input--compact"
              type="password"
              :placeholder="t('settings.aiAssistant.apiKeyPlaceholder')"
            />
          </div>
          <div class="edit-row">
            <label class="edit-label">{{ t('settings.aiAssistant.model') }}</label>
            <select v-model="addForm.model" class="ui-select ui-select--compact">
              <option v-for="m in addFormModels" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="edit-row">
            <label class="edit-label">{{ t('settings.aiAssistant.providerName') }}</label>
            <input
              v-model="addForm.name"
              class="ui-input ui-input--compact"
              type="text"
              :placeholder="t('settings.aiAssistant.providerNamePlaceholder')"
            />
          </div>
        </div>
        <div class="provider-card__actions">
          <button
            class="ui-btn ui-btn--secondary ui-btn--sm"
            :disabled="actionLoading"
            @click="cancelAdd"
          >
            {{ t('settings.aiAssistant.cancel') }}
          </button>
          <button
            class="ui-btn ui-btn--primary ui-btn--sm"
            :disabled="actionLoading || !addForm.presetId || !addForm.apiKey"
            @click="handleCreate"
          >
            <span v-if="actionLoading" class="spinner-sm"></span>
            {{ t('settings.aiAssistant.create') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 高级：配置文件（暂时隐藏） -->
    <div v-if="false" class="settings-section">
      <details class="advanced-details">
        <summary class="advanced-summary">
          {{ t('settings.aiAssistant.advanced') }}
          <span class="advanced-hint">{{ t('settings.aiAssistant.advancedHint') }}</span>
        </summary>
        <div class="advanced-content">
          <div class="settings-row">
            <div class="settings-row__desc">
              <span class="settings-code">{{ configPath || '~/.precis/ai_providers.yaml' }}</span>
            </div>
            <div class="settings-row__control">
              <button
                v-if="shellApi.canOpenLocalFile"
                class="ui-btn ui-btn--secondary ui-btn--sm"
                type="button"
                @click="openConfigFile"
              >
                {{ t('settings.aiAssistant.openConfigFile') }}
              </button>
            </div>
          </div>
          <div class="settings-row" style="flex-direction: column; gap: var(--ui-space-sm)">
            <div class="settings-row__desc settings-row__control--full" style="width: 100%">
              <pre class="config-template">{{ configTemplate }}</pre>
            </div>
            <div class="settings-row__control">
              <button
                class="ui-btn ui-btn--secondary ui-btn--sm"
                type="button"
                @click="copyTemplate"
              >
                {{ copied ? t('settings.aiAssistant.copied') : t('common.copy') }}
              </button>
            </div>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed, onMounted, reactive, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import { useToast } from '@/composables/shared'
  import { shellApi } from '@/core/capabilities/shellApi'
  import type { CloudAIProviderResponse, ProviderPreset, UpdateProviderRequest } from '@/types/ai'
  import {
    getCloudAIProviders,
    getActiveCloudAIProvider,
    getCloudAIProviderConfigInfo,
    testCloudAIProvider,
    activateCloudAIProvider,
    getProviderPresets,
    createCloudAIProvider,
    updateCloudAIProvider,
    deleteCloudAIProvider,
  } from '@/api/aiApi'
  const { t } = useI18n()
  const { success: showSuccess, error: showError } = useToast()
  const { showConfirm } = useGlobalConfirm()

  const providers = ref<CloudAIProviderResponse[]>([])
  const activeProviderId = ref<string | null>(null)
  const presets = ref<ProviderPreset[]>([])
  const configPath = ref('')
  const copied = ref(false)

  const testingProvider = ref<string | null>(null)
  const activatingProvider = ref<string | null>(null)
  const actionLoading = ref(false)
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

  // 添加表单
  const showAddForm = ref(false)
  const addForm = reactive({
    presetId: '',
    apiKey: '',
    model: '',
    name: '',
  })

  // 编辑表单
  const editingId = ref<string | null>(null)
  const editForm = reactive({
    name: '',
    apiKey: '',
    model: '',
    contextWindow: '',
  })

  const addFormModels = computed(() => {
    const preset = presets.value.find((p) => p.id === addForm.presetId)
    return preset?.models ?? []
  })

  const configTemplate = computed(
    () => `# ${t('settings.aiAssistant.configTemplateHeader')}
# ${t('settings.aiAssistant.configTemplateHint')}

version: "2.0"

providers:
  # ${t('settings.aiAssistant.configTemplateDeepSeek')}
  - id: deepseek
    name: DeepSeek
    type: openai
    base_url: https://api.deepseek.com
    api_key: \${DEEPSEEK_API_KEY}
    model: deepseek-v4-pro

  # ${t('settings.aiAssistant.configTemplateOllama')}
  - id: ollama-local
    name: Ollama Local
    type: ollama
    base_url: http://localhost:11434
    api_key: null
    model: llama3.2

defaults:
  chat: deepseek`
  )

  function presetModels(provider: CloudAIProviderResponse): string[] {
    return presets.value.find((p) => p.base_url === provider.base_url)?.models ?? []
  }

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

  async function loadPresets(): Promise<void> {
    try {
      presets.value = await getProviderPresets()
    } catch (error) {
      logger.error('[AIAssistantSettings] Failed to load presets:', error)
      presets.value = []
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
        showSuccess(
          t('settings.aiAssistant.testSuccessTitle'),
          t('settings.aiAssistant.testSuccessDesc')
        )
      } else {
        showError(
          t('settings.aiAssistant.testFailedTitle'),
          result.health.error || t('settings.aiAssistant.testFailedUnknown')
        )
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
      showSuccess(
        t('settings.aiAssistant.activateSuccessTitle'),
        t('settings.aiAssistant.activateSuccessDesc')
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showError(t('settings.aiAssistant.activateFailedTitle'), msg)
    } finally {
      activatingProvider.value = null
    }
  }

  function openAddForm(): void {
    showAddForm.value = true
    const deepseekPreset = presets.value.find((p) => p.id === 'deepseek')
    addForm.presetId = deepseekPreset?.id ?? presets.value[0]?.id ?? ''
    addForm.apiKey = ''
    addForm.model = deepseekPreset?.default_model ?? 'deepseek-v4-pro'
    addForm.name = deepseekPreset?.name ?? 'DeepSeek'
  }

  function cancelAdd(): void {
    showAddForm.value = false
  }

  async function handleCreate(): Promise<void> {
    const preset = presets.value.find((p) => p.id === addForm.presetId)
    if (!preset) return

    actionLoading.value = true
    try {
      await createCloudAIProvider({
        name: addForm.name || preset.name,
        type: preset.type as 'openai' | 'ollama',
        base_url: preset.base_url,
        api_key: addForm.apiKey,
        model: addForm.model,
      })
      showSuccess(t('settings.aiAssistant.createdSuccess'), '')
      showAddForm.value = false
      await loadProviders()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showError(t('settings.aiAssistant.createdFailed'), msg)
    } finally {
      actionLoading.value = false
    }
  }

  function startEdit(provider: CloudAIProviderResponse): void {
    editingId.value = provider.id
    editForm.name = provider.name
    editForm.apiKey = ''
    editForm.model = provider.model
    editForm.contextWindow = provider.context_window ? String(provider.context_window) : ''
  }

  function cancelEdit(): void {
    editingId.value = null
  }

  async function handleUpdate(providerId: string): Promise<void> {
    actionLoading.value = true
    try {
      const req: UpdateProviderRequest = {}
      if (editForm.name) req.name = editForm.name
      if (editForm.apiKey) req.api_key = editForm.apiKey
      if (editForm.model) req.model = editForm.model
      // context_window：填了数字才提交，空值不传（保持后端原值/自动探测）
      const cw = Number(editForm.contextWindow)
      if (editForm.contextWindow && Number.isFinite(cw) && cw >= 1024) {
        req.context_window = cw
      }
      await updateCloudAIProvider(providerId, req)
      showSuccess(t('settings.aiAssistant.updatedSuccess'), '')
      editingId.value = null
      await loadProviders()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showError(t('settings.aiAssistant.updatedFailed'), msg)
    } finally {
      actionLoading.value = false
    }
  }

  async function handleDelete(providerId: string, providerName: string): Promise<void> {
    const confirmed = await showConfirm({
      title: t('settings.aiAssistant.delete'),
      message: t('settings.aiAssistant.deleteConfirm'),
      confirmText: t('settings.aiAssistant.delete'),
      type: 'error',
    })
    if (!confirmed) return

    actionLoading.value = true
    try {
      await deleteCloudAIProvider(providerId)
      showSuccess(t('settings.aiAssistant.deletedSuccess'), '')
      if (editingId.value === providerId) editingId.value = null
      delete testResults.value[providerId]
      await loadProviders()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showError(t('settings.aiAssistant.deletedFailed'), msg)
    } finally {
      actionLoading.value = false
    }
  }

  async function openConfigFile(): Promise<void> {
    const path = configPath.value || '~/.precis/ai_providers.yaml'
    try {
      const result = await shellApi.openFile(path)
      if (!result.success) {
        showError(t('settings.aiAssistant.openConfigFileFailed'))
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
    loadPresets()
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
    padding: var(--ui-space-lg);
    transition: all 0.2s ease;
  }

  .provider-card--active {
    border-color: var(--ui-accent);
    box-shadow:
      0 0 0 1px var(--ui-accent),
      var(--ui-shadow-elevation-sm);
  }

  .provider-card--active .provider-card__icon {
    color: var(--ui-accent);
    background: var(--ui-accent-weak);
  }

  .provider-card--add {
    border-style: dashed;
    border-color: var(--ui-accent);
    background: var(--ui-bg-base);
  }

  .provider-card__header {
    display: flex;
    align-items: center;
    gap: var(--ui-space-md);
    margin-bottom: var(--ui-space-md);
  }

  .provider-card__icon {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-subtle);
    color: var(--ui-text-muted);
    flex-shrink: 0;
  }

  .provider-card__info {
    flex: 1;
    min-width: 0;
  }

  .provider-card__name {
    font-weight: var(--ui-font-weight-semibold);
    font-size: var(--ui-font-size-md);
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    color: var(--ui-text-title);
  }

  .provider-card__badge {
    font-size: var(--ui-font-size-xs);
    padding: 2px 8px;
    border-radius: var(--ui-radius-sm);
    font-weight: var(--ui-font-weight-medium);
  }

  .provider-card__badge--active {
    background: var(--ui-accent-weak);
    color: var(--ui-accent);
  }

  .provider-card__meta {
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-muted);
    margin-top: 2px;
  }

  .provider-card__status {
    flex-shrink: 0;
  }

  .provider-card__test-result {
    margin-top: var(--ui-space-md);
    padding-top: var(--ui-space-md);
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

  .provider-card__actions {
    display: flex;
    gap: var(--ui-space-sm);
    flex-shrink: 0;
    margin-top: var(--ui-space-md);
    flex-wrap: wrap;
  }

  .provider-card__edit-form {
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-md);
    margin-bottom: var(--ui-space-md);
  }

  .edit-row {
    display: flex;
    align-items: center;
    gap: var(--ui-space-md);
  }

  .edit-label {
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-muted);
    min-width: 80px;
    flex-shrink: 0;
  }

  .edit-row .ui-input.ui-input--compact,
  .edit-row .ui-select.ui-select--compact {
    flex: 1;
  }

  .spinner-sm {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid var(--ui-border-light);
    border-top-color: var(--ui-color-primary);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    margin-right: 4px;
    vertical-align: middle;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .provider-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--ui-space-3xl);
    text-align: center;
    color: var(--ui-text-muted);
    background: var(--ui-bg-elevated);
    border: 1px dashed var(--ui-border-light);
    border-radius: var(--ui-radius-lg);
    gap: var(--ui-space-md);
  }

  .provider-empty__icon {
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-subtle);
    color: var(--ui-text-muted);
    opacity: 0.6;
  }

  .provider-empty__title {
    font-size: var(--ui-font-size-md);
    font-weight: var(--ui-font-weight-semibold);
    color: var(--ui-text-body);
  }

  .provider-empty__text {
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-muted);
    max-width: 360px;
  }

  .provider-card__icon--accent {
    color: var(--ui-accent);
    background: var(--ui-accent-weak);
  }

  .advanced-details {
    margin-top: var(--ui-space-lg);
  }

  .advanced-summary {
    cursor: pointer;
    font-weight: 500;
    color: var(--ui-text-secondary);
    padding: var(--ui-space-sm) 0;
    user-select: none;
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
  }

  .advanced-hint {
    font-weight: 400;
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-muted);
  }

  .advanced-content {
    padding-top: var(--ui-space-sm);
    display: flex;
    flex-direction: column;
    gap: var(--ui-space-md);
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

  .settings-code {
    font-family: var(--ui-font-family-mono, monospace);
    font-size: var(--ui-font-size-sm);
    color: var(--ui-text-secondary);
  }

  .ui-btn--danger-text {
    color: var(--ui-color-error);
  }

  .ui-btn--danger-text:hover {
    background: var(--ui-color-error-light, rgba(239, 68, 68, 0.1));
  }
</style>

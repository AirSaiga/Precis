<!--
  @file ConfigPanel.vue
  @description AI 配置生成器顶部操作条（原左侧面板）

  功能职责：
  - 文件选择按钮 + 已选文件计数（可折叠展开文件列表）
  - Provider 状态徽章
  - 生成/取消按钮

  移除了原 Step 2（生成选项），所有参数使用硬编码默认值。
-->
<template>
  <div class="left-panel">
    <!-- Data Source Section -->
    <div class="panel-section">
      <div class="section-title">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
          />
        </svg>
        <span>{{ t('aiConfigGenerator.sections.dataSource') }}</span>
      </div>
      <div class="section-body">
        <div class="file-actions">
          <button class="action-btn" type="button" @click="emit('pick-files')">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
            {{ t('aiConfigGenerator.actions.pickFiles') }}
          </button>
          <button class="action-btn" type="button" @click="emit('pick-folders')">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
              />
            </svg>
            {{ t('aiConfigGenerator.actions.pickFolders') }}
          </button>
        </div>

        <div v-if="selectedPaths.length" class="file-list-box">
          <div class="file-list-header">
            <span class="file-list-title">
              {{ t('aiConfigGenerator.selectedCount', { count: checkedFiles.size }) }} /
              {{ expandedFiles.length }}
            </span>
            <div class="header-actions">
              <button class="text-btn" :disabled="isExpanding" @click="emit('toggle-all')">
                {{
                  checkedFiles.size === expandedFiles.length
                    ? t('aiConfigGenerator.actions.selectNone')
                    : t('aiConfigGenerator.actions.selectAll')
                }}
              </button>
              <button class="clear-btn" @click="emit('clear')">
                {{ t('aiConfigGenerator.actions.clear') }}
              </button>
            </div>
          </div>
          <div class="file-list-scroll">
            <div v-if="isExpanding" class="loading-placeholder">
              {{ t('aiConfigGenerator.fileList.loading') }}
            </div>
            <div
              v-else
              v-for="p in expandedFiles"
              :key="p"
              class="file-item"
              :class="{ disabled: !checkedFiles.has(p) }"
              :title="p"
              @click="emit('toggle-file', p)"
            >
              <input
                type="checkbox"
                :checked="checkedFiles.has(p)"
                @click.stop="emit('toggle-file', p)"
              />
              <span class="file-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                </svg>
              </span>
              <span class="file-path">{{ p.split(/[\\/]/).pop() }}</span>
            </div>
          </div>
        </div>

        <span v-else class="no-files-hint">{{ t('aiConfigGenerator.noFiles') }}</span>
      </div>
    </div>

    <!-- Agent Options Section -->
    <div class="panel-section">
      <div class="section-title">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
          />
        </svg>
        <span>{{ t('aiConfigGenerator.agentMode.label') }}</span>
      </div>
      <div class="section-body">
        <label class="switch-label">
          <input
            :checked="agentMode"
            type="checkbox"
            class="switch-input"
            :disabled="generating"
            @change="emit('update:agent-mode', ($event.target as HTMLInputElement).checked)"
          />
          <span class="switch-track">
            <span class="switch-thumb"></span>
          </span>
          <span class="switch-text">{{ t('aiConfigGenerator.agentMode.hint') }}</span>
        </label>
        <Transition name="agent-params">
          <div v-if="agentMode" class="agent-params-inline">
            <div class="agent-param-row">
              <span class="param-label">{{ t('aiConfigGenerator.agentMode.maxIterations') }}</span>
              <div class="param-control">
                <input
                  :value="maxIterations"
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  :disabled="generating"
                  @input="
                    emit('update:max-iterations', Number(($event.target as HTMLInputElement).value))
                  "
                />
                <span class="param-value">{{ maxIterations }}</span>
              </div>
            </div>
            <div class="agent-param-row">
              <span class="param-label">{{
                t('aiConfigGenerator.agentMode.validationSampleSize')
              }}</span>
              <select
                :value="validationSampleSize"
                :disabled="generating"
                @change="
                  emit(
                    'update:validation-sample-size',
                    Number(($event.target as HTMLSelectElement).value)
                  )
                "
              >
                <option :value="500">500</option>
                <option :value="1000">1000</option>
                <option :value="2000">2000</option>
                <option :value="5000">5000</option>
              </select>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Mode Tabs -->
    <div class="mode-tabs">
      <button
        class="mode-tab"
        :class="{ active: activeTab === 'generate' }"
        @click="emit('update:active-tab', 'generate')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3v18" />
          <path d="m8 21 4 3 4-3" />
          <path d="M8 3 12 0l4 3" />
          <path d="M20 18a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z" />
          <path d="M4 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" />
          <path d="m19.5 15.5-7-7" />
        </svg>
        <span>{{ t('aiConfigGenerator.tabs.generate') }}</span>
      </button>
      <button
        class="mode-tab"
        :class="{ active: activeTab === 'migrate' }"
        @click="emit('update:active-tab', 'migrate')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 3v18" />
          <path d="m8 21 4 3 4-3" />
          <rect width="20" height="8" x="2" y="3" rx="2" />
          <path d="M4 17h16" />
          <path d="M4 21h16" />
        </svg>
        <span>{{ t('aiConfigGenerator.tabs.migrate') }}</span>
      </button>
    </div>

    <!-- Action Footer -->
    <div class="left-panel-footer">
      <button
        class="generate-btn"
        type="button"
        :disabled="generating || checkedFiles.size === 0 || !provider?.is_configured"
        :title="!provider?.is_configured ? t('aiConfigGenerator.errors.modelNotConfigured') : ''"
        @click="emit('generate')"
      >
        <span v-if="generating" class="spinner-sm"></span>
        {{
          generating
            ? t('aiConfigGenerator.actions.generating')
            : t('aiConfigGenerator.actions.startGeneration')
        }}
      </button>
      <button
        v-if="generating"
        class="cancel-btn"
        type="button"
        :disabled="canceling"
        @click="emit('cancel')"
      >
        {{
          canceling
            ? t('aiConfigGenerator.actions.canceling')
            : t('aiConfigGenerator.actions.cancel')
        }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import type { CloudAIProviderResponse } from '@/types/ai'

  defineProps<{
    checkedFiles: Set<string>
    expandedFiles: string[]
    selectedPaths: string[]
    isExpanding: boolean
    generating: boolean
    canceling: boolean
    provider: CloudAIProviderResponse | null
    activeTab: 'generate' | 'migrate'
    agentMode: boolean
    maxIterations: number
    validationSampleSize: number
  }>()

  const { t } = useI18n()
  const emit = defineEmits<{
    generate: []
    cancel: []
    'pick-files': []
    'pick-folders': []
    'toggle-file': [file: string]
    'toggle-all': []
    clear: []
    'update:active-tab': [tab: 'generate' | 'migrate']
    'update:agent-mode': [value: boolean]
    'update:max-iterations': [value: number]
    'update:validation-sample-size': [value: number]
  }>()
</script>

<style scoped src="./ConfigPanel.styles.css"></style>

<!--
  @file AIConfigGenerateModal.vue
  @description AI 智能配置生成模态框（拆分后壳组件）

  功能职责：
  - 保留 Modal 壳结构（Teleport、遮罩、标题栏）
  - 组合 4 个 composables 和 6 个子组件
  - 管理 options 和 advancedOptionsVisible 响应式状态
  - 处理模态框打开/关闭时的状态重置
  - 调用 ConflictResolutionModal 处理配置合并冲突

  Props:
    - visible: boolean  控制模态框显示/隐藏

  Emits:
    - close:  用户点击关闭或取消时触发
-->
<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="handleClose">
      <div class="modal-content ai-config-modal">
        <div class="modal-header">
          <div class="header-title">
            <div class="header-icon">✨</div>
            <h3>{{ t('aiConfigGenerator.title') }}</h3>
          </div>
          <button class="close-btn" type="button" :disabled="generating" @click="handleClose">
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <!-- Left Panel: Configuration Wizard -->
          <div class="config-panel">
            <!-- Section 1: Data Sources -->
            <div class="config-section">
              <div class="section-header">
                <span class="step-badge">1</span>
                <span class="section-title">{{ t('aiConfigGenerator.sections.dataSource') }}</span>
              </div>
              <AIConfigFileSelector
                :checked-files="checkedFiles"
                :expanded-files="expandedFiles"
                :is-expanding="isExpanding"
                :selected-paths="selectedPaths"
                @pick-files="pickFiles"
                @pick-folders="pickFolders"
                @toggle-file="toggleFile"
                @toggle-all="toggleAllFiles"
                @clear="clearSelection"
              />
            </div>

            <!-- Section 2: Generation Options -->
            <div class="config-section">
              <div class="section-header">
                <span class="step-badge">2</span>
                <span class="section-title">{{
                  t('aiConfigGenerator.sections.generationOptions')
                }}</span>
              </div>
              <AIConfigOptionsPanel
                :options="options"
                :advanced-visible="advancedOptionsVisible"
                @update:options="options = $event"
                @update:advanced-visible="advancedOptionsVisible = $event"
                @reset-defaults="options = createDefaultOptions()"
              />
            </div>

            <!-- Section 3: Current AI Model Info -->
            <div class="config-section">
              <div class="section-header">
                <span class="step-badge">3</span>
                <span class="section-title">{{ t('aiConfigGenerator.sections.aiProvider') }}</span>
              </div>
              <AIProviderStatusCard :provider="activeProvider" />
            </div>

            <!-- Main Actions -->
            <div class="panel-actions">
              <button
                class="btn-primary big-generate-btn"
                type="button"
                :disabled="generating || checkedFiles.size === 0 || !activeProvider?.is_configured"
                :title="
                  !activeProvider?.is_configured
                    ? t('aiConfigGenerator.errors.modelNotConfigured')
                    : ''
                "
                @click="generate"
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
                class="btn-secondary"
                type="button"
                :disabled="canceling"
                @click="cancelGenerate"
              >
                {{
                  canceling
                    ? t('aiConfigGenerator.actions.canceling')
                    : t('aiConfigGenerator.actions.cancel')
                }}
              </button>
            </div>
          </div>

          <!-- Right Panel: Preview & Result -->
          <AIGenerationPreview
            :generating="generating"
            :generated-config="generatedConfig"
            :elapsed-time-text="elapsedTimeText"
            :warnings="warnings"
            :hardware-warnings="hardwareWarnings"
            :yaml-string="yamlPreview"
            :stage-label="stageLabel"
            :progress-message="progressMessage"
            :received-chars="receivedChars"
            :applying="applying"
            @apply="applyToProject"
            @close="handleClose"
          />
        </div>
      </div>
    </div>
  </Teleport>

  <ConflictResolutionModal
    v-if="conflictModalVisible && comparisonResult && generatedConfig?.manifest && originalManifest"
    :visible="conflictModalVisible"
    :comparison="comparisonResult"
    :generated-manifest="generatedConfig.manifest"
    :original-manifest="originalManifest"
    @close="conflictModalVisible = false"
    @confirm="handleConflictConfirm"
  />
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed, ref, watch, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useProjectStore } from '@/stores/projectStore'
  import { getActiveCloudAIProvider } from '@/api/aiApi'
  import { getV2FullConfig } from '@/api/projectV2Api'
  import { createDefaultOptions } from '@/services/ai/generationOptions'
  import type { CloudAIProviderResponse } from '@/types/ai'
  import type { AiGenerateV2ConfigOptions } from '@/types/ai'
  import ConflictResolutionModal from './ConflictResolutionModal.vue'

  import { useAiFileSelection } from '@/composables/ai/useAiFileSelection'
  import { useAiGenerationJob } from '@/composables/ai/useAiGenerationJob'
  import { useAiConflictApply } from '@/composables/ai/useAiConflictApply'
  import { useAiHardwarePrecheck } from '@/composables/ai/useAiHardwarePrecheck'

  import AIConfigFileSelector from './ai-config-generate/AIConfigFileSelector.vue'
  import AIConfigOptionsPanel from './ai-config-generate/AIConfigOptionsPanel.vue'
  import AIProviderStatusCard from './ai-config-generate/AIProviderStatusCard.vue'
  import AIGenerationPreview from './ai-config-generate/AIGenerationPreview.vue'

  const props = defineProps<{
    visible: boolean
  }>()

  const emit = defineEmits<{
    (e: 'close'): void
  }>()

  const { t } = useI18n()
  const projectStore = useProjectStore()

  const effectiveConfigPath = computed(() => projectStore.currentPaths?.configPath)

  // ==================== AI Provider ====================
  const activeProvider = ref<CloudAIProviderResponse | null>(null)

  const loadActiveProvider = async () => {
    try {
      const provider = await getActiveCloudAIProvider()
      activeProvider.value = provider
    } catch (e) {
      logger.error('Failed to load active provider', e)
      activeProvider.value = null
    }
  }

  // ==================== Composables ====================
  const fileSelection = useAiFileSelection(effectiveConfigPath, t)
  const {
    selectedPaths,
    expandedFiles,
    checkedFiles,
    isExpanding,
    toggleFile,
    toggleAllFiles,
    pickFiles,
    pickFolders,
    collectExistingDataSources,
    loadProjectDataSources,
    clearSelection,
  } = fileSelection

  const options = ref<AiGenerateV2ConfigOptions>(createDefaultOptions())
  const advancedOptionsVisible = ref(false)

  const hardwarePrecheck = useAiHardwarePrecheck(activeProvider, t)
  const { hardwareWarnings, runHardwarePrecheck } = hardwarePrecheck

  const generationJob = useAiGenerationJob(
    effectiveConfigPath,
    checkedFiles,
    options,
    activeProvider,
    t
  )
  const {
    generating,
    canceling,
    currentStage,
    progressMessage,
    receivedChars,
    warnings,
    elapsedTimeText,
    stageLabel,
    generatedConfig,
    yamlPreview,
    generate: startGeneration,
    cancelGenerate,
    stopPolling,
    stopElapsed,
  } = generationJob

  const conflictApply = useAiConflictApply(effectiveConfigPath, generatedConfig, t)
  const {
    applying,
    conflictModalVisible,
    comparisonResult,
    originalManifest,
    cachedFullConfig,
    applyToProject,
    handleConflictConfirm,
  } = conflictApply

  // ==================== Watch & Lifecycle ====================
  watch(
    () => props.visible,
    (v) => {
      if (!v) return
      // 重置文件选择
      selectedPaths.value = collectExistingDataSources()
      expandedFiles.value = []
      checkedFiles.value = new Set()
      isExpanding.value = false
      // 重置生成任务状态
      warnings.value = []
      hardwareWarnings.value = []
      generationJob.generateStartedAt.value = null
      generationJob.lastElapsedMs.value = null
      stopElapsed()
      yamlPreview.value = ''
      generatedConfig.value = null
      generationJob.jobId.value = null
      currentStage.value = ''
      progressMessage.value = ''
      receivedChars.value = 0
      canceling.value = false
      // 重置冲突与应用状态
      cachedFullConfig.value = null
      conflictModalVisible.value = false
      comparisonResult.value = null
      originalManifest.value = null
      applying.value = false
      // 重置选项
      advancedOptionsVisible.value = false
      options.value = createDefaultOptions()
      // 停止轮询
      stopPolling()
      // 加载 Provider 和项目数据源
      void loadActiveProvider()
      void loadProjectDataSources()
    }
  )

  onUnmounted(() => {
    stopPolling()
    stopElapsed()
  })

  // ==================== Event Handlers ====================
  const handleClose = () => {
    if (generating.value) {
      window.$toast?.info(t('common.info'), t('aiConfigGenerator.errors.closeWhileGenerating'))
      return
    }
    stopPolling()
    stopElapsed()
    emit('close')
  }

  /**
   * 启动生成任务
   */
  const generate = async () => {
    await startGeneration(async () => {
      await runHardwarePrecheck()
      // 缓存现有配置（供 keep_existing 时复用）
      if (options.value.keep_existing && effectiveConfigPath.value) {
        try {
          cachedFullConfig.value = await getV2FullConfig(effectiveConfigPath.value)
        } catch (e) {
          logger.warn('Failed to load existing config, proceeding with empty base', e)
          cachedFullConfig.value = null
        }
      }
    })
  }
</script>

<style scoped src="./AIConfigGenerateModal.styles.css"></style>

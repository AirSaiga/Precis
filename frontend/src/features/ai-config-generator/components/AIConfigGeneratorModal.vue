<!--
  @file AIConfigGeneratorModal.vue
  @description AI 智能配置生成模态框壳组件

  功能职责：
  - Modal 壳结构（Teleport、遮罩、标题栏 + ProviderBadge）
  - 组合 4 个 composables 和子组件
  - 通过 store 管理 visible / provider 状态
  - 通过 registerResetHook 注册 composable 的重置逻辑
  - 调用 ConflictResolutionModal 处理配置合并冲突

  Props:
    - visible: boolean  控制模态框显示/隐藏

  Emits:
    - close:  用户点击关闭或取消时触发
-->
<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="handleClose">
      <div class="modal-content" role="dialog" aria-modal="true" :aria-label="t('aiConfigGenerator.title')">
        <div class="modal-header">
          <div class="header-title">
            <div class="header-icon" aria-hidden="true">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
            </div>
            <h3>{{ t('aiConfigGenerator.title') }}</h3>
          </div>
          <div class="header-meta">
            <ProviderBadge :provider="store.activeProvider" />
            <button class="close-btn" type="button" :disabled="generating" :aria-label="t('common.close')" @click="handleClose">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div class="modal-body">
          <!-- Top Action Bar: File selection + Generate -->
          <ConfigPanel
            :checked-files="checkedFiles"
            :expanded-files="expandedFiles"
            :is-expanding="isExpanding"
            :selected-paths="selectedPaths"
            :generating="generating"
            :canceling="canceling"
            @generate="generate"
            @cancel="cancelGenerate"
            @pick-files="pickFiles"
            @pick-folders="pickFolders"
            @toggle-file="toggleFile"
            @toggle-all="toggleAllFiles"
            @clear="clearSelection"
          />

          <!-- Full-width Preview & Result -->
          <PreviewPanel
            :state="previewState"
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
  import { computed, watch, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useProjectStore } from '@/stores/projectStore'
  import { getV2FullConfig } from '@/api/projectV2Api'
  import { useAiConfigGeneratorStore } from '../stores/aiConfigGeneratorStore'
  import ConflictResolutionModal from '@/components/common/ConflictResolutionModal.vue'

  import { useFileSelection } from '../composables/useFileSelection'
  import { useGenerationJob } from '../composables/useGenerationJob'
  import { useConflictApply } from '../composables/useConflictApply'
  import { useHardwarePrecheck } from '../composables/useHardwarePrecheck'

  import ConfigPanel from './config-panel/ConfigPanel.vue'
  import PreviewPanel from './preview-panel/PreviewPanel.vue'
  import ProviderBadge from './config-panel/ProviderBadge.vue'

  const props = defineProps<{
    visible: boolean
  }>()

  const { t } = useI18n()
  const projectStore = useProjectStore()
  const store = useAiConfigGeneratorStore()

  const effectiveConfigPath = computed(() => projectStore.currentPaths?.configPath)

  // 从 store 获取共享状态
  const { activeProvider, options } = store

  // ==================== Composables ====================
  const fileSelection = useFileSelection(effectiveConfigPath)
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

  const hardwarePrecheck = useHardwarePrecheck(activeProvider)
  const { hardwareWarnings, runHardwarePrecheck } = hardwarePrecheck

  const generationJob = useGenerationJob(
    effectiveConfigPath,
    checkedFiles,
    options,
    activeProvider
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

  const conflictApply = useConflictApply(effectiveConfigPath, generatedConfig)
  const {
    applying,
    conflictModalVisible,
    comparisonResult,
    originalManifest,
    cachedFullConfig,
    applyToProject,
    handleConflictConfirm,
  } = conflictApply

  // ==================== 聚合 PreviewPanel 状态 ====================
  const previewState = computed(() => ({
    generating: generating.value,
    generatedConfig: generatedConfig.value,
    elapsedTimeText: elapsedTimeText.value,
    warnings: warnings.value,
    hardwareWarnings: hardwareWarnings.value,
    yamlString: yamlPreview.value,
    stageLabel: stageLabel.value,
    progressMessage: progressMessage.value,
    receivedChars: receivedChars.value,
    applying: applying.value,
  }))

  // ==================== 注册重置钩子到 Store ====================
  /**
   * 重置所有 composable 状态（在 store.open() 时被调用）
   */
  store.registerResetHook(() => {
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
    // 停止轮询
    stopPolling()
  })

  // 监听 visible 变化以触发项目数据源加载
  watch(
    () => props.visible,
    (v) => {
      if (v) {
        void loadProjectDataSources()
      }
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
    store.close()
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

<style scoped src="./AIConfigGeneratorModal.styles.css"></style>

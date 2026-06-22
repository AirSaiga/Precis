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
      <div
        class="modal-content"
        role="dialog"
        aria-modal="true"
        :aria-label="t('aiConfigGenerator.title')"
      >
        <div class="modal-header">
          <div class="header-title">
            <div class="header-icon" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
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
            </div>
            <h3>{{ t('aiConfigGenerator.title') }}</h3>
          </div>
          <div class="header-meta">
            <ProviderBadge :provider="store.activeProvider" />
            <button
              class="close-btn"
              type="button"
              :disabled="generating"
              :aria-label="t('common.close')"
              @click="handleClose"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
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
        </div>

        <div class="modal-body">
          <ConfigPanel
            :checked-files="checkedFiles"
            :expanded-files="expandedFiles"
            :is-expanding="isExpanding"
            :selected-paths="selectedPaths"
            :generating="generating"
            :canceling="canceling"
            :provider="store.activeProvider"
            :active-tab="activeTab"
            :agent-mode="options.agent_mode"
            :max-iterations="options.max_iterations"
            :validation-sample-size="options.validation_sample_size"
            @generate="generate"
            @cancel="cancelGenerate"
            @pick-files="pickFiles"
            @pick-folders="pickFolders"
            @toggle-file="toggleFile"
            @toggle-all="toggleAllFiles"
            @clear="clearSelection"
            @update:active-tab="activeTab = $event"
            @update:agent-mode="options.agent_mode = $event"
            @update:max-iterations="options.max_iterations = $event"
            @update:validation-sample-size="options.validation_sample_size = $event"
          />

          <div class="right-column">
            <MigratePanel
              v-if="activeTab === 'migrate'"
              :generating="generating"
              :canceling="canceling"
              :provider="store.activeProvider"
              :checked-files="checkedFiles"
              :sources="migrateSources"
              @update:sources="migrateSources = $event"
              @pick-script-files="handlePickScriptFiles"
              @pick-script-folder="handlePickScriptFolder"
              @start-migration="startMigration"
              @cancel-migration="cancelMigration"
            />
            <PreviewPanel :state="previewState" @apply="overwriteProject" @close="handleClose" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ConflictResolutionModal 已隐藏，作为日后高级功能保留 -->
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { computed, ref, watch, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { storeToRefs } from 'pinia'
  import { useProjectStore } from '@/stores/projectStore'
  import { useGraphStore } from '@/stores/graphStore'
  import { putV2FullConfig } from '@/api/projectV2Api'
  import { useGlobalConfirm } from '@/composables/useGlobalConfirm'
  import * as fileApi from '@/core/capabilities/fileApi'
  import { useAiConfigGeneratorStore } from '../stores/aiConfigGeneratorStore'
  // import ConflictResolutionModal from '@/components/common/ConflictResolutionModal.vue'

  import { useFileSelection } from '../composables/useFileSelection'
  import { useGenerationJob } from '../composables/useGenerationJob'
  import { useMigrationJob } from '../composables/useMigrationJob'
  import { useHardwarePrecheck } from '../composables/useHardwarePrecheck'
  import ConfigPanel from './config-panel/ConfigPanel.vue'
  import MigratePanel from './migrate-panel/MigratePanel.vue'
  import PreviewPanel from './preview-panel/PreviewPanel.vue'
  import ProviderBadge from './config-panel/ProviderBadge.vue'

  const props = defineProps<{
    visible: boolean
  }>()

  const emit = defineEmits<{
    close: []
  }>()

  const { t } = useI18n()
  const { showConfirm } = useGlobalConfirm()
  const projectStore = useProjectStore()
  const store = useAiConfigGeneratorStore()
  const graphStore = useGraphStore()

  const applying = ref(false)
  const activeTab = ref<'generate' | 'migrate'>('generate')
  const migrateSources = ref<Array<{ content: string; language: string; name?: string }>>([])

  // 使用 storeToRefs 保持 ref 的响应式
  const { activeProvider, options } = storeToRefs(store)

  const effectiveConfigPath = computed(() => projectStore.currentPaths?.configPath)

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
    pickScriptFiles,
    pickScriptFolder,
    collectExistingDataSources,
    loadProjectDataSources,
    clearSelection,
  } = fileSelection

  const hardwarePrecheck = useHardwarePrecheck(activeProvider)
  const { hardwareWarnings, runHardwarePrecheck } = hardwarePrecheck

  const generationJob = useGenerationJob(effectiveConfigPath, checkedFiles, options, activeProvider)
  const {
    generating,
    canceling,
    jobId,
    currentStage,
    progressMessage,
    receivedChars,
    warnings,
    generateStartedAt,
    lastElapsedMs,
    elapsedNow,
    elapsedTimeText,
    stageLabel,
    iterations,
    maxIterations,
    metrics,
    currentPlan,
    generatedConfig,
    yamlPreview,
    pollTimer,
    elapsedTimer,
    generate: startGeneration,
    cancelGenerate,
    stopPolling,
    stopElapsed,
  } = generationJob

  const migrationJob = useMigrationJob(effectiveConfigPath, checkedFiles, options, activeProvider, {
    generating,
    canceling,
    jobId,
    currentStage,
    progressMessage,
    warnings,
    generateStartedAt,
    lastElapsedMs,
    elapsedNow,
    pollTimer,
    elapsedTimer,
    generatedConfig,
    yamlPreview,
  })
  const { startMigration: runMigration, cancelMigration } = migrationJob

  /**
   * 推断脚本语言
   */
  const inferScriptLanguage = (filePath: string): string => {
    const lower = filePath.toLowerCase()
    if (lower.endsWith('.py')) return 'python'
    if (lower.endsWith('.sql')) return 'sql'
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv'))
      return 'excel_formula'
    return 'natural_language'
  }

  /**
   * 读取本地脚本文件内容（Electron 使用 IPC，Web 使用 HTTP 文件 API）
   */
  const readLocalScriptFiles = async (paths: string[]) => {
    const newSources = [...migrateSources.value]
    for (const p of paths) {
      try {
        const content = await fileApi.readFile(p)
        if (content != null) {
          newSources.push({
            content,
            language: inferScriptLanguage(p),
            name: p,
          })
        }
      } catch (e) {
        logger.warn('Failed to read script file', p, e)
      }
    }
    migrateSources.value = newSources
  }

  /**
   * 处理选择脚本文件
   */
  const handlePickScriptFiles = async () => {
    const paths = await pickScriptFiles()
    if (paths.length) await readLocalScriptFiles(paths)
  }

  /**
   * 处理选择脚本文件夹（递归查找）
   *
   * Electron 下返回目录路径，需递归扫描后读取；
   * Web 下 pickScriptFolder 已通过 webkitdirectory 平铺上传目录内文件，
   * 返回的是临时文件路径，直接读取即可。
   */
  const handlePickScriptFolder = async () => {
    const paths = await pickScriptFolder()
    if (!paths.length) return

    // 如果返回的是目录路径（Electron），先递归扫描；如果已是文件路径（Web），直接读取
    const firstPath = paths[0]
    const isDirectoryPath =
      paths.length === 1 && firstPath && !firstPath.match(/\.(py|sql|md|txt|js|json|yaml|yml)$/i)
    if (isDirectoryPath && firstPath) {
      const files = await fileApi.readdirRecursive(firstPath, [
        '.py',
        '.sql',
        '.md',
        '.txt',
        '.js',
        '.json',
        '.yaml',
        '.yml',
      ])
      await readLocalScriptFiles(files)
    } else {
      await readLocalScriptFiles(paths)
    }
  }

  /**
   * 启动迁移任务
   */
  const startMigration = async (
    sources: Array<{ content: string; language: string; name?: string }>
  ) => {
    const projectName = graphStore.projectName || 'precis-project'
    await runMigration(sources, projectName)
  }

  // 直接覆盖：生成结果 -> putV2FullConfig（不再走冲突解决模态框）
  const overwriteProject = async () => {
    if (!effectiveConfigPath.value || !generatedConfig.value) return
    const cfg = generatedConfig.value
    if (!cfg.manifest) {
      window.$toast?.error(
        t('aiConfigGenerator.toast.applyFailed'),
        t('aiConfigGenerator.errors.manifestMissing')
      )
      return
    }
    const schemaCount = Object.keys(cfg.schemas || {}).length
    const constraintCount = Object.keys(cfg.constraints || {}).length
    const regexCount = Object.keys(cfg.regex_nodes || {}).length

    const confirmed = await showConfirm({
      title: t('aiConfigGenerator.actions.apply'),
      message: t('aiConfigGenerator.overwriteConfirm', {
        schemas: schemaCount,
        constraints: constraintCount,
        regex: regexCount,
      }),
      confirmText: t('aiConfigGenerator.actions.apply'),
      type: 'warning',
    })
    if (!confirmed) return

    applying.value = true
    try {
      const payload = {
        manifest: cfg.manifest,
        schemas: cfg.schemas || {},
        constraints: cfg.constraints || {},
        regex_nodes: cfg.regex_nodes || {},
        transforms: cfg.transforms || {},
        manual_data: cfg.manual_data || {},
      }
      await putV2FullConfig(payload, effectiveConfigPath.value)
      window.$toast?.success(t('common.success'), t('aiConfigGenerator.toast.applied'))
      store.close()
      // 触发项目刷新
      setTimeout(() => {
        window.location.reload()
      }, 500)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      window.$toast?.error(t('aiConfigGenerator.toast.applyFailed'), msg)
    } finally {
      applying.value = false
    }
  }

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
    iterations: iterations.value,
    maxIterations: maxIterations.value,
    metrics: metrics.value,
    currentPlan: currentPlan.value,
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
    // 重置应用状态
    applying.value = false
    // 重置迁移状态
    migrateSources.value = []
    activeTab.value = 'generate'
    // 停止轮询
    stopPolling()
  })

  // 监听 visible 变化以触发项目数据源加载和 Provider 重新加载
  watch(
    () => props.visible,
    (v) => {
      if (v) {
        void loadProjectDataSources()
        void store.loadActiveProvider()
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
    emit('close')
  }

  /**
   * 启动生成任务
   */
  const generate = async () => {
    await startGeneration(async () => {
      await runHardwarePrecheck()
    })
  }
</script>

<style scoped src="./AIConfigGeneratorModal.styles.css"></style>

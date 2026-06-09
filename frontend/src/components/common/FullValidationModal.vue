<!--
  @file FullValidationModal.vue
  @description 全量数据校验任务面板（向导式交互）- Redesign 版本

  功能职责：
  - 以向导形式引导用户完成校验：配置 → 执行 → 结果
  - 支持实时进度跟踪、错误分组筛选、画布节点定位
-->
<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useValidationTaskRunner } from '@/composables/validation/useValidationTaskRunner'
  import { useValidationReportExport } from '@/composables/useValidationReportExport'
  import { useValidationErrorFilter } from '@/composables/validation/useValidationErrorFilter'
  import { useValidationErrorNavigator } from '@/composables/validation/useValidationErrorNavigator'
  import { createValidationReportViewModel } from '@/services/validationReportViewModel'
  import ValidationScopeCards from '@/components/validation/ValidationScopeCards.vue'
  import ValidationContextBar from '@/components/validation/ValidationContextBar.vue'
  import ValidationSettingsGrid from '@/components/validation/ValidationSettingsGrid.vue'
  import ValidationPreflightAlert from '@/components/validation/ValidationPreflightAlert.vue'
  import ValidationProgressBar from '@/components/validation/ValidationProgressBar.vue'
  import ValidationStageTimeline from '@/components/validation/ValidationStageTimeline.vue'
  import ValidationStatsMini from '@/components/validation/ValidationStatsMini.vue'
  import ValidationErrorFilterBar from '@/components/validation/ValidationErrorFilterBar.vue'
  import ValidationErrorGroup from '@/components/validation/ValidationErrorGroup.vue'
  import ValidationReportPreview from './ValidationReportPreview.vue'

  const props = defineProps<{ modelValue: boolean }>()
  const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const settingsStore = useSettingsStore()
  const { exportReport: exportValidationReport } = useValidationReportExport()
  const { navigateErrorToCanvas } = useValidationErrorNavigator()

  const {
    running,
    errorMessage,
    result,
    progress,
    processedStats,
    projectConfigPath,
    saveBeforeRun,
    missingResourcesStrategy,
    runtimeValidationSettings,
    hasRuntimeOverrides,
    taskStages,
    preflightSummary,
    preflightIssueCount,
    preflightStatusTone,
    currentTargetLabel,
    currentTableId,
    targetDescriptors,
    availableTableTargets,
    resultHighlights,
    showMergeConfirm,
    refreshPreflight,
    resetRuntimeOverrides,
    selectTargetType,
    selectTableTarget,
    runTask,
    confirmMergeAndRun,
    runDirectly,
    cancelMergePrompt,
  } = useValidationTaskRunner()

  const showPreview = ref(false)
  const showExportMenu = ref(false)
  const currentView = ref<'config' | 'running' | 'results'>('config')

  // 报告视图模型（转换原始错误数据为展示友好的格式）
  const reportViewModel = computed(() =>
    createValidationReportViewModel(result.value, { rowLabel: t('common.fullValidation.table.row') })
  )

  // 结果页筛选
  const errorFilter = computed(() => {
    if (!reportViewModel.value.errors.length) {
      return {
        stageFilter: ref('all' as const),
        groupBy: ref('table' as const),
        searchQuery: ref(''),
        groupedErrors: ref({} as Record<string, any>),
      }
    }
    return useValidationErrorFilter(reportViewModel.value.errors)
  })

  // 自动视图切换
  watch(running, (isRunning, wasRunning) => {
    if (isRunning) {
      currentView.value = 'running'
    } else if (wasRunning === true) {
      currentView.value = 'results'
    }
  })

  watch(result, (res) => {
    if (res) {
      currentView.value = 'results'
    }
  })

  watch(
    () => props.modelValue,
    (open) => {
      if (open) {
        currentView.value = result.value ? 'results' : running.value ? 'running' : 'config'
        return
      }
      showExportMenu.value = false
      showPreview.value = false
    }
  )

  const setView = (view: 'config' | 'running' | 'results') => {
    currentView.value = view
  }

  const stepList = computed(() => [
    {
      key: 'config' as const,
      label: t('common.fullValidation.task.sections.prepare'),
      completed: result.value !== null || running.value,
      disabled: false,
    },
    {
      key: 'running' as const,
      label: t('common.fullValidation.task.sections.run'),
      completed: result.value !== null,
      disabled: !running.value && !result.value,
    },
    {
      key: 'results' as const,
      label: t('common.fullValidation.task.sections.result'),
      completed: false,
      disabled: !result.value,
    },
  ])

  const preflightStatusText = computed(() => {
    if (!projectConfigPath.value) return t('common.fullValidation.task.preflight.noProject')
    if (preflightIssueCount.value === 0) return t('common.fullValidation.task.preflight.ready')
    return t('common.fullValidation.task.preflight.attention', { count: preflightIssueCount.value })
  })

  const close = () => emit('update:modelValue', false)

  const handleExportReport = async (format: 'html' | 'pdf') => {
    if (!result.value) return
    showExportMenu.value = false
    await exportValidationReport(result.value, format, graphStore.projectName)
  }

  const handleNavigateError = async (error: any) => {
    close()
    await navigateErrorToCanvas(error)
  }

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (!target.closest('.export-dropdown')) {
      showExportMenu.value = false
    }
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !props.modelValue) return
    if (showMergeConfirm.value) {
      cancelMergePrompt()
      return
    }
    close()
  }

  onMounted(() => {
    document.addEventListener('click', handleDocumentClick)
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleDocumentClick)
    document.removeEventListener('keydown', handleKeydown)
  })
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="fv-overlay">
        <div class="fv-modal" role="dialog" aria-modal="true">
          <!-- Header -->
          <div class="fv-header">
            <div class="fv-header-main">
              <h2 class="fv-header-title">{{ t('common.fullValidation.title') }}</h2>
              <span v-if="currentTargetLabel" class="ui-badge is-primary">{{
                currentTargetLabel
              }}</span>
            </div>
            <button class="ui-icon-btn" type="button" @click="close">×</button>
          </div>

          <!-- Step Navigation -->
          <div class="fv-steps">
            <button
              v-for="(step, idx) in stepList"
              :key="step.key"
              class="fv-step"
              :class="{
                'is-active': currentView === step.key,
                'is-completed': step.completed,
                'is-disabled': step.disabled,
              }"
              type="button"
              :disabled="step.disabled"
              @click="setView(step.key)"
            >
              <span class="fv-step-num">{{ idx + 1 }}</span>
              <span class="fv-step-label">{{ step.label }}</span>
            </button>
          </div>

          <!-- Body -->
          <div class="fv-body">
            <!-- ====== CONFIG VIEW ====== -->
            <div v-if="currentView === 'config'" class="fv-view">
              <ValidationScopeCards
                :items="targetDescriptors"
                :current-table-id="currentTableId"
                :table-options="availableTableTargets"
                @select-type="selectTargetType"
                @select-table="selectTableTarget"
              />

              <ValidationContextBar
                :target-label="currentTargetLabel"
                :config-path="projectConfigPath"
                :preflight-status="preflightStatusText"
                :preflight-tone="preflightStatusTone"
              />

              <ValidationPreflightAlert
                :issue-count="preflightIssueCount"
                :missing-constraints="preflightSummary.missingConstraintRefs"
                :missing-regexes="preflightSummary.missingRegexRefs"
                :dangling-constraints="preflightSummary.danglingConstraintRefs"
                :dangling-regexes="preflightSummary.danglingRegexRefs"
                @refresh="refreshPreflight"
              />

              <ValidationSettingsGrid
                :settings="runtimeValidationSettings"
                :save-before-run="saveBeforeRun"
                :missing-strategy="missingResourcesStrategy"
                :has-overrides="hasRuntimeOverrides"
                @update:settings="runtimeValidationSettings = $event"
                @update:save-before-run="saveBeforeRun = $event"
                @update:missing-strategy="missingResourcesStrategy = $event"
                @reset="resetRuntimeOverrides"
              />

              <!-- Primary CTA -->
              <div class="fv-footer-actions fv-footer-actions--primary">
                <button
                  class="ui-btn ui-btn--primary ui-btn--lg fv-run-btn"
                  type="button"
                  :disabled="running"
                  @click="runTask"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {{ t('common.fullValidation.task.runNow') }}
                </button>
              </div>
            </div>

            <!-- ====== RUNNING VIEW ====== -->
            <div v-else-if="currentView === 'running'" class="fv-view fv-view--center">
              <ValidationProgressBar
                :progress="progress"
                :current-table="
                  processedStats.tablesLoaded > 0 ? `表 ${processedStats.tablesLoaded}` : undefined
                "
                :errors-found="processedStats.errorsFound"
              />

              <div class="fv-running-status">
                <div
                  class="fv-status-icon-lg"
                  :class="{
                    'is-spinning': running,
                    'is-success': !running && result?.success,
                    'is-error': !running && result && !result.success,
                  }"
                >
                  <!-- Running: spinner -->
                  <svg
                    v-if="running"
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <!-- Completed + success: check -->
                  <svg
                    v-else-if="result?.success"
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <!-- Completed + error: x -->
                  <svg
                    v-else
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <h3
                  class="fv-running-title"
                  :class="{
                    'is-success': !running && result?.success,
                    'is-error': !running && result && !result.success,
                  }"
                >
                  {{
                    running
                      ? t('common.fullValidation.run.running')
                      : result?.success
                        ? t('common.fullValidation.run.completed')
                        : t('common.fullValidation.run.completedWithErrors')
                  }}
                </h3>
              </div>

              <ValidationStageTimeline :stages="taskStages" />

              <ValidationStatsMini
                :files-loaded="processedStats.filesLoaded"
                :files-total="processedStats.filesTotal"
                :tables-loaded="processedStats.tablesLoaded"
                :tables-total="processedStats.tablesTotal"
                :errors-found="processedStats.errorsFound"
                :duration-ms="result?.summary?.duration_ms || 0"
              />

              <div v-if="errorMessage" class="fv-run-error">
                {{ errorMessage }}
              </div>
            </div>

            <!-- ====== RESULTS VIEW ====== -->
            <div v-else-if="currentView === 'results'" class="fv-view">
              <!-- Status Banner -->
              <div class="fv-status-banner" :class="result?.success ? 'is-success' : 'is-error'">
                <div class="fv-status-icon">
                  <svg
                    v-if="result?.success"
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <svg
                    v-else
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <div class="fv-status-main">
                  <div class="fv-status-title">
                    {{
                      result?.success
                        ? t('common.fullValidation.result.pass')
                        : t('common.fullValidation.result.fail')
                    }}
                  </div>
                  <div class="fv-status-sub">
                    {{
                      result?.success
                        ? t('common.fullValidation.result.completeSuccess')
                        : t('common.fullValidation.result.completeWithErrors')
                    }}
                  </div>
                </div>
                <div class="fv-status-rate">
                  {{ result?.statistics?.pass_rate?.toFixed(1) || '0.0' }}%
                </div>
              </div>

              <!-- Stats -->
              <div class="fv-stats">
                <div
                  v-for="item in resultHighlights"
                  :key="item.key"
                  class="fv-stat"
                  :class="`is-${item.key}`"
                >
                  <div class="fv-stat-value">{{ item.value }}</div>
                  <div class="fv-stat-label">{{ item.label }}</div>
                </div>
              </div>

              <!-- Error Filter & Grouped List -->
              <div v-if="result?.errors?.length" class="fv-errors">
                <ValidationErrorFilterBar
                  v-model:stage-filter="errorFilter.stageFilter.value"
                  v-model:group-by="errorFilter.groupBy.value"
                  v-model:search-query="errorFilter.searchQuery.value"
                />

                <div class="fv-error-groups">
                  <ValidationErrorGroup
                    v-for="(errors, groupName) in errorFilter.groupedErrors.value"
                    :key="groupName"
                    :group-name="groupName"
                    :errors="errors"
                    @navigate="handleNavigateError"
                  />
                </div>
              </div>

              <!-- Empty success -->
              <div v-else-if="result?.success" class="fv-empty-success">
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <p>{{ t('common.fullValidation.result.completeSuccess') }}</p>
              </div>

              <!-- Result Actions -->
              <div class="fv-footer-actions">
                <button class="ui-btn ui-btn--secondary" type="button" @click="runTask">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {{ t('common.fullValidation.task.runNow') }}
                </button>
                <button class="ui-btn ui-btn--ghost" type="button" @click="showPreview = true">
                  {{ t('common.fullValidation.export.preview') }}
                </button>
                <div class="export-dropdown">
                  <button
                    class="ui-btn ui-btn--ghost"
                    type="button"
                    @click="showExportMenu = !showExportMenu"
                  >
                    {{ t('common.fullValidation.export.exportReport') }}
                  </button>
                  <div v-if="showExportMenu" class="export-menu">
                    <button
                      class="export-menu-item"
                      type="button"
                      @click="handleExportReport('html')"
                    >
                      {{ t('common.fullValidation.export.exportHtml') }}
                    </button>
                    <button
                      class="export-menu-item"
                      type="button"
                      @click="handleExportReport('pdf')"
                    >
                      {{ t('common.fullValidation.export.exportPdf') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- Merge Confirm Modal -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="showMergeConfirm" class="merge-confirm-overlay">
        <div class="merge-confirm-modal" role="dialog" aria-modal="true">
          <div class="merge-confirm-header">
            <div class="merge-confirm-title">
              {{ t('common.fullValidation.mergeConstraints.title') }}
            </div>
            <button class="ui-icon-btn" type="button" @click="cancelMergePrompt">×</button>
          </div>
          <div class="merge-confirm-body">
            <p class="merge-confirm-copy">
              {{
                t('common.fullValidation.mergeConstraints.message', {
                  constraintCount: preflightSummary.missingConstraintRefs.length,
                  regexCount: preflightSummary.missingRegexRefs.length,
                })
              }}
            </p>
            <div class="tag-group">
              <code
                v-for="item in [
                  ...preflightSummary.missingConstraintRefs,
                  ...preflightSummary.missingRegexRefs,
                ].slice(0, 10)"
                :key="item.id"
                class="resource-tag"
              >
                {{ item.id }}
              </code>
            </div>
            <p class="merge-confirm-hint">
              {{ t('common.fullValidation.mergeConstraints.hint') }}
            </p>
          </div>
          <div class="merge-confirm-footer">
            <button class="ui-btn ui-btn--secondary" type="button" @click="cancelMergePrompt">
              {{ t('common.fullValidation.mergeConstraints.cancel') }}
            </button>
            <button class="ui-btn ui-btn--ghost" type="button" @click="runDirectly">
              {{ t('common.fullValidation.mergeConstraints.validateDirectly') }}
            </button>
            <button class="ui-btn ui-btn--primary" type="button" @click="confirmMergeAndRun">
              {{ t('common.fullValidation.mergeConstraints.mergeAndValidate') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <ValidationReportPreview
    v-if="result"
    v-model="showPreview"
    :data="result"
    :project-name="graphStore.projectName"
    :timestamp="new Date().toLocaleString('zh-CN')"
  />
</template>

<style src="./FullValidationModal.css"></style>

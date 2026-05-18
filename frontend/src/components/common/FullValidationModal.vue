<!--
  @file FullValidationModal.vue
  @description 全量数据校验任务面板（向导式交互）

  功能职责：
  - 以向导形式引导用户完成校验：配置 → 执行 → 结果
  - 每一步只展示当前阶段内容，降低认知负担
  - 顶部步骤条同时作为进度指示器和导航入口
  - 执行阶段提供实时进度反馈
  - 结果阶段提供完整的数据概览与操作入口

  Props:
    - modelValue: boolean  控制模态框显示/隐藏

  Emits:
    - update:modelValue: 模态框显隐状态变更
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="fv-overlay" @click.self="close">
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
              <!-- Scope Selector -->
              <div class="fv-section">
                <h3 class="fv-section-title">{{ t('common.fullValidation.task.scope.title') }}</h3>
                <div class="fv-scope-grid">
                  <button
                    v-for="item in targetDescriptors"
                    :key="item.type"
                    class="fv-scope-card"
                    :class="{
                      'is-active': item.status === 'active',
                      'is-disabled': item.status === 'planned',
                    }"
                    type="button"
                    :disabled="item.status === 'planned'"
                    @click="selectTargetType(item.type)"
                  >
                    <div class="fv-scope-card-top">
                      <span class="fv-scope-name">{{ item.label }}</span>
                      <span v-if="item.status === 'active'" class="ui-badge is-primary">
                        {{ t('common.fullValidation.task.scope.active') }}
                      </span>
                      <span v-else-if="item.status === 'planned'" class="ui-badge">
                        {{ t('common.fullValidation.task.scope.planned') }}
                      </span>
                    </div>
                    <p class="fv-scope-desc">{{ item.description }}</p>
                  </button>
                </div>

                <!-- Single table selector -->
                <div v-if="currentTableId" class="fv-field">
                  <label class="form-label">
                    {{ t('common.fullValidation.task.scope.tableSelector') }}
                  </label>
                  <select
                    class="ui-select"
                    :value="currentTableId"
                    @change="selectTableTarget(($event.target as HTMLSelectElement).value)"
                  >
                    <option
                      v-for="opt in availableTableTargets"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ formatTableOptionLabel(opt) }}
                    </option>
                  </select>
                </div>
              </div>

              <!-- Context bar -->
              <div class="fv-context-bar">
                <div class="fv-context-item">
                  <span class="fv-context-label">
                    {{ t('common.fullValidation.task.context.target') }}
                  </span>
                  <span class="fv-context-value">{{ currentTargetLabel }}</span>
                </div>
                <div class="fv-context-item">
                  <span class="fv-context-label">
                    {{ t('common.fullValidation.project.configPath') }}
                  </span>
                  <span class="fv-context-value mono" :title="projectConfigPath">
                    {{ projectConfigPath || '-' }}
                  </span>
                </div>
                <div class="fv-context-item">
                  <span class="fv-context-label">
                    {{ t('common.fullValidation.task.preflight.title') }}
                  </span>
                  <span class="fv-context-value" :class="`is-${preflightStatusTone}`">
                    {{ preflightStatusText }}
                  </span>
                </div>
              </div>

              <!-- Preflight details -->
              <details v-if="preflightIssueCount > 0" class="fv-details">
                <summary class="fv-details-summary">
                  <span>
                    {{
                      t('common.fullValidation.task.preflight.attention', {
                        count: preflightIssueCount,
                      })
                    }}
                  </span>
                  <button
                    class="ui-btn ui-btn--ghost ui-btn--xs"
                    type="button"
                    @click.stop="refreshPreflight"
                  >
                    {{ t('common.refresh') }}
                  </button>
                </summary>
                <div class="fv-details-body">
                  <div class="fv-preflight-row">
                    <span>{{ t('common.fullValidation.task.preflight.unlistedResources') }}</span>
                    <span>
                      {{
                        preflightSummary.missingConstraintRefs.length +
                        preflightSummary.missingRegexRefs.length
                      }}
                    </span>
                  </div>
                  <div class="fv-preflight-row">
                    <span>{{ t('common.fullValidation.task.preflight.danglingResources') }}</span>
                    <span>
                      {{
                        preflightSummary.danglingConstraintRefs.length +
                        preflightSummary.danglingRegexRefs.length
                      }}
                    </span>
                  </div>
                  <div class="tag-group">
                    <code
                      v-for="item in [
                        ...preflightSummary.missingConstraintRefs,
                        ...preflightSummary.missingRegexRefs,
                        ...preflightSummary.danglingConstraintRefs,
                        ...preflightSummary.danglingRegexRefs,
                      ].slice(0, 10)"
                      :key="item.id"
                      class="resource-tag"
                    >
                      {{ item.id }}
                    </code>
                  </div>
                </div>
              </details>

              <!-- Settings -->
              <div class="fv-section">
                <h3 class="fv-section-title">
                  {{ t('common.fullValidation.task.overrides.title') }}
                </h3>
                <div class="fv-settings-grid">
                  <label class="fv-field">
                    <span class="form-label">{{ t('settings.project.strictMode.label') }}</span>
                    <label class="ui-switch">
                      <input
                        v-model="runtimeValidationSettings.strict_mode"
                        class="ui-switch__input"
                        type="checkbox"
                      />
                      <span class="ui-switch__track"></span>
                    </label>
                  </label>

                  <label class="fv-field">
                    <span class="form-label">{{ t('settings.project.errorHandling.label') }}</span>
                    <select
                      v-model="runtimeValidationSettings.error_handling"
                      class="ui-select ui-select--compact"
                    >
                      <option value="stop">
                        {{ t('settings.project.errorHandling.stop') }}
                      </option>
                      <option value="continue">
                        {{ t('settings.project.errorHandling.continue') }}
                      </option>
                      <option value="report">
                        {{ t('settings.project.errorHandling.report') }}
                      </option>
                    </select>
                  </label>

                  <label class="fv-field">
                    <span class="form-label">{{ t('settings.project.timeout.label') }}</span>
                    <input
                      v-model.number="runtimeValidationSettings.timeout_seconds"
                      class="ui-input ui-input--compact"
                      type="number"
                      min="1"
                      max="300"
                    />
                  </label>

                  <label class="fv-field">
                    <span class="form-label">{{ t('settings.project.batchLimit.label') }}</span>
                    <input
                      v-model.number="runtimeValidationSettings.batch_max_files"
                      class="ui-input ui-input--compact"
                      type="number"
                      min="1"
                      max="1000"
                    />
                  </label>

                  <label class="fv-field fv-field--wide">
                    <span class="form-label">
                      {{ t('common.fullValidation.task.options.saveBeforeRun') }}
                    </span>
                    <label class="ui-switch">
                      <input v-model="saveBeforeRun" class="ui-switch__input" type="checkbox" />
                      <span class="ui-switch__track"></span>
                    </label>
                  </label>

                  <label class="fv-field fv-field--wide">
                    <span class="form-label">
                      {{ t('common.fullValidation.task.options.missingResources') }}
                    </span>
                    <select v-model="missingResourcesStrategy" class="ui-select ui-select--compact">
                      <option value="ask">
                        {{ t('common.fullValidation.task.options.ask') }}
                      </option>
                      <option value="merge_then_run">
                        {{ t('common.fullValidation.task.options.mergeThenRun') }}
                      </option>
                      <option value="run_directly">
                        {{ t('common.fullValidation.task.options.runDirectly') }}
                      </option>
                    </select>
                  </label>
                </div>
                <p class="override-hint">
                  {{
                    hasRuntimeOverrides
                      ? t('common.fullValidation.task.overrides.active')
                      : t('common.fullValidation.task.overrides.inheritDefaults')
                  }}
                </p>
              </div>

              <!-- Primary CTA -->
              <div class="fv-footer-actions">
                <button
                  class="ui-btn ui-btn--primary ui-btn--lg"
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
                <button class="ui-btn ui-btn--ghost" type="button" @click="resetRuntimeOverrides">
                  {{ t('common.fullValidation.task.resetOverrides') }}
                </button>
              </div>
            </div>

            <!-- ====== RUNNING VIEW ====== -->
            <div v-else-if="currentView === 'running'" class="fv-view fv-view--center">
              <!-- Active execution state -->
              <template v-if="running">
                <div class="fv-spinner">
                  <svg
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
                </div>
                <h3 class="fv-running-title">{{ t('common.fullValidation.run.running') }}</h3>
                <p class="fv-running-sub">{{ currentStageLabel }}</p>
              </template>

              <!-- Completed state (user navigated back to running view) -->
              <template v-else>
                <div class="fv-spinner is-completed">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <h3 class="fv-running-title">{{ t('common.fullValidation.run.completed') }}</h3>
                <p class="fv-running-sub">{{ currentStageLabel }}</p>
              </template>

              <div class="fv-stage-list">
                <div
                  v-for="item in taskStages"
                  :key="item.key"
                  class="fv-stage-row"
                  :class="`is-${item.status}`"
                >
                  <span class="fv-stage-icon">
                    <svg
                      v-if="item.status === 'success'"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <svg
                      v-else-if="item.status === 'running'"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="spin"
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <svg
                      v-else-if="item.status === 'error'"
                      width="16"
                      height="16"
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
                    <svg
                      v-else-if="item.status === 'skipped'"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M5 12h14" />
                    </svg>
                    <span v-else class="fv-stage-dot"></span>
                  </span>
                  <span class="fv-stage-name">{{ item.label }}</span>
                  <span class="fv-stage-desc">{{ item.description }}</span>
                  <span class="fv-stage-status">
                    {{ t(`common.fullValidation.task.stageStatus.${item.status}`) }}
                  </span>
                </div>
              </div>

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

              <!-- Errors -->
              <div v-if="result?.errors?.length" class="fv-errors">
                <div class="fv-errors-header">
                  <h3 class="fv-section-title">
                    {{ t('common.fullValidation.task.resultPreview') }}
                  </h3>
                  <span class="ui-badge is-danger">{{ result.errors.length }}</span>
                </div>
                <div class="fv-error-list">
                  <div
                    v-for="(item, index) in result.errors.slice(0, 10)"
                    :key="index"
                    class="fv-error-item"
                    @click="showPreview = true"
                  >
                    <div class="fv-error-top">
                      <span
                        class="ui-badge"
                        :class="
                          item.stage === 'constraint'
                            ? 'is-danger'
                            : item.stage === 'format'
                              ? 'is-warning'
                              : 'is-info'
                        "
                      >
                        {{ item.stage }}
                      </span>
                      <span class="fv-error-type">
                        {{ item.check_type || item.error_type }}
                      </span>
                    </div>
                    <div class="fv-error-msg">{{ item.message }}</div>
                    <div class="fv-error-meta">
                      <span v-if="item.source_file">
                        {{ item.source_file.split(/[\\/]/).pop() || item.source_file
                        }}{{ item.source_sheet ? `-${item.source_sheet}` : '' }}
                      </span>
                      <span v-else-if="item.table">{{ item.table }}</span>
                      <span v-if="item.column">{{ item.column }}</span>
                      <span v-if="typeof item.row_index === 'number'">
                        {{ t('common.fullValidation.table.row') }} {{ item.row_index + 1 }}
                      </span>
                    </div>
                  </div>
                </div>
                <div v-if="result.errors.length > 10" class="fv-errors-more">
                  <button
                    class="ui-btn ui-btn--ghost ui-btn--sm"
                    type="button"
                    @click="showPreview = true"
                  >
                    {{ t('common.fullValidation.export.preview') }}
                    <span class="ui-badge is-danger">+{{ result.errors.length - 10 }}</span>
                  </button>
                </div>
              </div>

              <!-- Error message (API failure) -->
              <div v-if="errorMessage && !result?.errors?.length" class="fv-run-error">
                {{ errorMessage }}
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

              <!-- Warnings -->
              <div v-if="result?.warnings?.length" class="fv-warnings">
                <div class="fv-section-title">
                  {{ t('common.fullValidation.report.warnings') }} ({{ result.warnings.length }})
                </div>
                <ul class="fv-warning-list">
                  <li v-for="(w, i) in result.warnings" :key="i">{{ w }}</li>
                </ul>
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
      <div v-if="showMergeConfirm" class="merge-confirm-overlay" @click.self="cancelMergePrompt">
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

<script setup lang="ts">
  import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import { useSettingsStore } from '@/stores/settingsStore'
  import { useValidationTaskRunner } from '@/composables/validation/useValidationTaskRunner'
  import { useValidationReportExport } from '@/composables/useValidationReportExport'
  import ValidationReportPreview from './ValidationReportPreview.vue'

  const props = defineProps<{ modelValue: boolean }>()
  const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

  const { t } = useI18n()
  const graphStore = useGraphStore()
  const settingsStore = useSettingsStore()
  const { exportReport: exportValidationReport } = useValidationReportExport()

  const {
    running,
    errorMessage,
    result,
    dataSources,
    projectConfigPath,
    resolvedDataDirectoryLabel,
    saveBeforeRun,
    missingResourcesStrategy,
    runtimeValidationSettings,
    defaultValidationSettings,
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
    initializeTask,
    refreshPreflight,
    resetRuntimeOverrides,
    selectTargetType,
    selectTableTarget,
    runTask,
    saveProjectOnly,
    confirmMergeAndRun,
    runDirectly,
    cancelMergePrompt,
  } = useValidationTaskRunner()

  const showPreview = ref(false)
  const showExportMenu = ref(false)

  // ============================================================================
  // View state management
  // ============================================================================
  const currentView = ref<'config' | 'running' | 'results'>('config')

  /**
   * 自动视图切换 - 双保险机制
   *
   * 使用两个独立的 watch（非 watchEffect），各自只监听一个 ref 的变化：
   * - watch(running): running 变为 true 时切到 running；running 从 true 变为 false 时切到 results
   * - watch(result): result 变为非 null 时切到 results（兜底，防止 running watch 漏触发）
   *
   * 关键：使用 watch(ref) 而非 watchEffect，这样回调不会在 currentView 变化时重新执行，
   * 用户手动点击步骤导航（如回到执行界面）不会被自动弹回。
   */
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

  const currentStageLabel = computed(() => {
    const runningStage = taskStages.value.find((s) => s.status === 'running')
    return runningStage?.label || ''
  })

  const preflightStatusText = computed(() => {
    if (!projectConfigPath.value) return t('common.fullValidation.task.preflight.noProject')
    if (preflightIssueCount.value === 0) return t('common.fullValidation.task.preflight.ready')
    return t('common.fullValidation.task.preflight.attention', {
      count: preflightIssueCount.value,
    })
  })

  // ============================================================================
  // Actions
  // ============================================================================
  const close = () => emit('update:modelValue', false)

  const formatTableOptionLabel = (item: {
    label: string
    sourceType?: 'csv' | 'excel' | 'json' | 'unknown'
  }) => {
    const typeLabel =
      item.sourceType && item.sourceType !== 'unknown'
        ? t(`common.fullValidation.task.scope.sourceTypes.${item.sourceType}`)
        : ''
    return typeLabel ? `[${typeLabel}] ${item.label}` : item.label
  }

  const handleExportReport = async (format: 'html' | 'pdf') => {
    if (!result.value) return
    showExportMenu.value = false
    await exportValidationReport(result.value, format, graphStore.projectName)
  }

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement
    if (!target.closest('.export-dropdown')) {
      showExportMenu.value = false
    }
  }

  onMounted(() => {
    document.addEventListener('click', handleDocumentClick)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleDocumentClick)
  })
</script>

<style scoped src="./FullValidationModal.css"></style>

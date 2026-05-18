<!--
  @file ValidationReportPreview.vue
  @description 数据校验报告预览模态框

  功能职责：
  - 展示全量数据校验的完整结果报告
  - 报告头部展示项目名称、生成时间、通过/失败状态标识
  - 按 Schema / Constraint / Regex 等维度分类展示校验结果
  - 展示详细的错误列表、行号、错误原因及统计信息
  - 支持报告内容导出为文件

  关键特性：
  - 可视化状态徽章（成功绿色 / 失败红色）
  - 元数据区域展示报告生成时间与校验耗时
  - 详情表格展示每条校验规则的结果统计
  - 错误项可展开查看具体失败的行数据
  - 底部提供导出报告操作按钮

  Props:
    - modelValue: boolean                 控制模态框显示/隐藏（支持 v-model）
    - data: FullValidationResponse | null 校验结果数据，包含各维度校验详情
    - projectName: string                项目名称，用于报告标题展示
    - timestamp: string                  报告生成时间字符串

  Emits:
    - update:modelValue: 模态框显隐状态变更时触发
-->
<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="report-preview-overlay" @click.self="close">
        <div class="report-preview-modal" role="dialog" aria-modal="true">
          <div class="report-preview-header">
            <div class="report-preview-title">{{ t('common.fullValidation.report.title') }}</div>
            <button class="report-preview-close" type="button" @click="close">×</button>
          </div>

          <div class="report-preview-body">
            <div class="report-preview-content">
              <div class="report-header">
                <div class="header-top">
                  <div class="header-title-group">
                    <h1 class="project-name">{{ projectName }}</h1>
                    <div class="report-subtitle">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                      {{ t('common.fullValidation.report.title') }}
                    </div>
                  </div>
                  <div class="status-badge" :class="data.success ? 'success' : 'error'">
                    <span class="status-icon">
                      <svg
                        v-if="data.success"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <svg
                        v-else
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
                    </span>
                    {{
                      data.success
                        ? t('common.fullValidation.report.statusPass')
                        : t('common.fullValidation.report.statusFail')
                    }}
                  </div>
                </div>
                <div class="header-meta">
                  <div class="meta-item">
                    <span class="meta-label">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      {{ t('common.fullValidation.report.generatedAt') }}
                    </span>
                    <span class="meta-value">{{ timestamp }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {{ t('common.fullValidation.report.duration') }}
                    </span>
                    <span class="meta-value">{{ data.summary?.duration_ms }}ms</span>
                  </div>
                </div>
              </div>

              <div class="stats-overview">
                <div class="stat-card stat-total">
                  <div class="stat-icon-wrapper">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </div>
                  <div class="stat-number">{{ data.statistics?.total_checks || 0 }}</div>
                  <div class="stat-label">{{ t('common.fullValidation.report.totalChecks') }}</div>
                </div>
                <div class="stat-card stat-passed">
                  <div class="stat-icon-wrapper">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div class="stat-number">{{ data.statistics?.passed_count || 0 }}</div>
                  <div class="stat-label">{{ t('common.fullValidation.report.passed') }}</div>
                </div>
                <div class="stat-card stat-failed">
                  <div class="stat-icon-wrapper">
                    <svg
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
                  </div>
                  <div class="stat-number">{{ data.statistics?.failed_count || 0 }}</div>
                  <div class="stat-label">{{ t('common.fullValidation.report.failed') }}</div>
                </div>
                <div class="stat-card stat-rate">
                  <div class="stat-icon-wrapper">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                  </div>
                  <div class="stat-number">{{ (data.statistics?.pass_rate || 0).toFixed(1) }}%</div>
                  <div class="stat-label">{{ t('common.fullValidation.report.passRate') }}</div>
                </div>
              </div>

              <div class="metrics-grid">
                <div class="metric-item">
                  <span class="metric-label">
                    <svg
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
                        d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                      />
                    </svg>
                    {{ t('common.fullValidation.report.totalFiles') }}
                  </span>
                  <span class="metric-value">{{ data.summary?.files_total }}</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                    </svg>
                    {{ t('common.fullValidation.report.loadedFiles') }}
                  </span>
                  <span class="metric-value">{{ data.summary?.files_loaded }}</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                      <line x1="9" y1="21" x2="9" y2="9" />
                    </svg>
                    {{ t('common.fullValidation.report.tablesLoaded') }}
                  </span>
                  <span class="metric-value">{{ data.summary?.tables_loaded }}</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {{ t('common.fullValidation.report.loadingErrors') }}
                  </span>
                  <span
                    class="metric-value"
                    :class="data.summary?.loading_error_count > 0 ? 'text-danger' : 'text-success'"
                    >{{ data.summary?.loading_error_count }}</span
                  >
                </div>
                <div class="metric-item">
                  <span class="metric-label">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="4 7 4 4 20 4 20 7" />
                      <line x1="9" y1="20" x2="15" y2="20" />
                      <line x1="12" y1="4" x2="12" y2="20" />
                    </svg>
                    {{ t('common.fullValidation.report.formatErrors') }}
                  </span>
                  <span
                    class="metric-value"
                    :class="data.summary?.format_error_count > 0 ? 'text-danger' : 'text-success'"
                    >{{ data.summary?.format_error_count }}</span
                  >
                </div>
                <div class="metric-item">
                  <span class="metric-label">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                    {{ t('common.fullValidation.report.constraintErrors') }}
                  </span>
                  <span
                    class="metric-value"
                    :class="
                      data.summary?.constraint_error_count > 0 ? 'text-danger' : 'text-success'
                    "
                    >{{ data.summary?.constraint_error_count }}</span
                  >
                </div>
              </div>

              <!-- 警告信息 -->
              <div v-if="data.warnings && data.warnings.length > 0" class="warnings-section">
                <div class="warnings-header">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path
                      d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                    />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span
                    >{{ t('common.fullValidation.report.warnings') }} ({{
                      data.warnings.length
                    }})</span
                  >
                </div>
                <ul class="warnings-list">
                  <li v-for="(warning, index) in data.warnings" :key="index" class="warning-item">
                    {{ warning }}
                  </li>
                </ul>
              </div>

              <div class="result-tabs">
                <button
                  class="result-tab"
                  :class="{ active: stageFilter === 'all' }"
                  type="button"
                  @click="stageFilter = 'all'"
                >
                  {{ t('common.fullValidation.result.all') }} ({{ allItemsCount }})
                </button>
                <button
                  class="result-tab"
                  :class="{ active: stageFilter === 'passed' }"
                  type="button"
                  @click="stageFilter = 'passed'"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {{ t('common.fullValidation.report.passed') }} ({{ passedItemsCount }})
                </button>
                <button
                  class="result-tab"
                  :class="{ active: stageFilter === 'failed' }"
                  type="button"
                  @click="stageFilter = 'failed'"
                >
                  <svg
                    width="14"
                    height="14"
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
                  {{ t('common.fullValidation.report.failed') }} ({{ failedItemsCount }})
                </button>
              </div>

              <div class="result-table">
                <div class="result-table-head">
                  <div class="col-stage">{{ t('common.fullValidation.table.stage') }}</div>
                  <div class="col-loc">{{ t('common.fullValidation.table.location') }}</div>
                  <div class="col-type">{{ t('common.fullValidation.table.type') }}</div>
                  <div class="col-msg">{{ t('common.fullValidation.table.message') }}</div>
                </div>

                <template v-if="stageFilter === 'all' || stageFilter === 'failed'">
                  <div
                    v-for="(e, idx) in filteredErrors"
                    :key="'error-' + idx"
                    class="result-table-row is-error"
                  >
                    <div class="col-stage">
                      <span class="badge badge-danger">{{ e.stage }}</span>
                    </div>
                    <div class="col-loc">
                      <span class="loc-main">{{ e.location }}</span>
                      <span v-if="e.source_path" class="loc-sub">{{ e.source_path }}</span>
                    </div>
                    <div class="col-type">{{ e.type_label }}</div>
                    <div class="col-msg">
                      {{ formatValidationReportMessage(e.message, e.table) }}
                    </div>
                  </div>
                </template>

                <template v-if="stageFilter === 'all' || stageFilter === 'passed'">
                  <div
                    v-for="(p, idx) in filteredPassedItems"
                    :key="'passed-' + idx"
                    class="result-table-row is-passed"
                  >
                    <div class="col-stage">
                      <span class="badge badge-success">{{ p.stage }}</span>
                    </div>
                    <div class="col-loc">
                      <span class="loc-main">{{ p.location }}</span>
                      <span v-if="p.source_path" class="loc-sub">{{ p.source_path }}</span>
                    </div>
                    <div class="col-type">{{ p.type_label }}</div>
                    <div class="col-msg">
                      {{ formatValidationReportMessage(p.message, p.table) }}
                    </div>
                  </div>
                </template>

                <div v-if="displayItems.length === 0" class="result-empty">
                  <svg
                    width="48"
                    height="48"
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
                  <p>{{ t('common.noData') }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="report-preview-footer">
            <button class="ui-btn ui-btn--secondary" type="button" @click="handleExportHtml">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {{ t('common.fullValidation.export.exportHtml') }}
            </button>
            <button class="ui-btn ui-btn--primary" type="button" @click="handleExportPdf">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {{ t('common.fullValidation.export.exportPdf') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  import { logger } from '@/core/utils/logger'
  import { ref, computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { FullValidationResponse } from '@/api/projectValidationApi'
  import { exportHtmlReport, exportPdfReport } from '@/services/reportExportService'
  import {
    createValidationReportViewModel,
    formatValidationReportMessage,
  } from '@/services/validationReportViewModel'

  const props = defineProps<{
    modelValue: boolean
    data: FullValidationResponse | null
    projectName: string
    timestamp: string
  }>()

  const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void
  }>()

  const { t } = useI18n()

  const stageFilter = ref<'all' | 'passed' | 'failed'>('all')

  const viewModel = computed(() =>
    createValidationReportViewModel(props.data, {
      rowLabel: t('common.fullValidation.table.row'),
    })
  )

  const filteredErrors = computed(() => {
    return viewModel.value.errors
  })

  const filteredPassedItems = computed(() => {
    return viewModel.value.passedItems
  })

  const displayItems = computed(() => {
    if (stageFilter.value === 'all') {
      return [...filteredErrors.value, ...filteredPassedItems.value]
    } else if (stageFilter.value === 'failed') {
      return filteredErrors.value
    } else {
      return filteredPassedItems.value
    }
  })

  const allItemsCount = computed(() => viewModel.value.allCount)
  const passedItemsCount = computed(() => viewModel.value.passedCount)
  const failedItemsCount = computed(() => viewModel.value.failedCount)

  const close = () => emit('update:modelValue', false)

  const handleExportHtml = () => {
    const options = {
      projectName: props.projectName,
      timestamp: props.timestamp,
      t: (key: string) => t(key),
    }
    exportHtmlReport(props.data, options)
    close()
  }

  const handleExportPdf = async () => {
    const options = {
      projectName: props.projectName,
      timestamp: props.timestamp,
      t: (key: string) => t(key),
    }
    try {
      await exportPdfReport(props.data, options)
      close()
    } catch (error) {
      logger.error('PDF export failed:', error)
    }
  }
</script>

<style scoped src="./ValidationReportPreview.css"></style>

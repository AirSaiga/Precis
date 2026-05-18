/**
 * @file htmlReportGenerator.ts
 * @description 校验报告 HTML 生成器
 *
 * 职责：
 * - 将后端校验结果转换为格式化的 HTML 报告
 * - 包含统计卡片、错误/通过详情表格
 * - 使用 i18n 国际化文本
 *
 * 架构设计：
 * - 纯函数设计，无副作用
 * - HTML 模板直接拼接，零依赖
 * - 复用 validationReportViewModel 进行数据转换
 */

import type { FullValidationResponse } from '@/api/projectValidationApi'
import {
  createValidationReportViewModel,
  formatValidationReportMessage,
  getValidationStageLabelKey,
} from '@/services/validationReportViewModel'
import type { ReportGenerateOptions } from '../reportExportService'
import { REPORT_CSS } from './reportStyles'

const ICONS = {
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  percent: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`,
  fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  barChart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  alertCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  layout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
}

export function generateHtmlReport(
  data: FullValidationResponse,
  options: ReportGenerateOptions
): string {
  const { projectName, timestamp, t } = options
  const { summary, statistics } = data
  const reportViewModel = createValidationReportViewModel(data, {
    rowLabel: t('common.fullValidation.table.row'),
  })

  const errorsHtml = reportViewModel.errors
    .map(
      (e, idx) => `
    <tr class="error-row">
      <td class="col-num">${idx + 1}</td>
      <td><span class="stage-badge stage-${e.normalized_stage}">${t(getValidationStageLabelKey(e.stage))}</span></td>
      <td class="col-table">${e.table || '-'}</td>
      <td class="col-column">${e.column || '-'}</td>
      <td class="col-type"><code class="type-code">${e.type_label}</code></td>
      <td class="col-msg">
        <div class="message-content">${formatValidationReportMessage(e.message, e.table)}</div>
        ${e.source_path ? `<div class="message-path">${e.source_path}</div>` : ''}
      </td>
    </tr>
  `
    )
    .join('')

  const passedHtml = reportViewModel.passedItems
    .map(
      (p, idx) => `
    <tr class="passed-row">
      <td class="col-num">${idx + 1}</td>
      <td><span class="stage-badge stage-${p.normalized_stage}">${t(getValidationStageLabelKey(p.stage))}</span></td>
      <td class="col-table">${p.table || '-'}</td>
      <td class="col-column">${p.column || '-'}</td>
      <td class="col-type"><code class="type-code">${p.type_label}</code></td>
      <td class="col-msg">${formatValidationReportMessage(p.message, p.table)}</td>
    </tr>
  `
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t('common.fullValidation.report.title')} - ${projectName}</title>
    ${REPORT_CSS}
</head>
<body>
  <div class="report-container">
    <div class="report-shell">
      <!-- Header -->
      <div class="report-header">
        <div class="header-top">
          <div class="header-title-group">
            <h1 class="project-name">${projectName}</h1>
            <div class="report-subtitle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              ${t('common.fullValidation.report.title')}
            </div>
          </div>
          <div class="status-badge ${data.success ? 'success' : 'error'}">
            <span class="status-icon">${data.success ? ICONS.check : ICONS.x}</span>
            ${data.success ? t('common.fullValidation.report.statusPass') : t('common.fullValidation.report.statusFail')}
          </div>
        </div>
        <div class="header-meta">
          <div class="meta-item">
            <span class="meta-label">${ICONS.calendar} ${t('common.fullValidation.report.generatedAt')}</span>
            <span class="meta-value">${timestamp}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">${ICONS.clock} ${t('common.fullValidation.report.duration')}</span>
            <span class="meta-value">${summary.duration_ms}ms</span>
          </div>
        </div>
      </div>

      <div class="report-body">
        <!-- Main Stats -->
        <div class="stats-overview">
          <div class="stat-card stat-total">
            <div class="stat-icon-wrapper">${ICONS.fileText}</div>
            <div class="stat-number">${statistics?.total_checks || 0}</div>
            <div class="stat-label">${t('common.fullValidation.report.totalChecks')}</div>
          </div>
          <div class="stat-card stat-passed">
            <div class="stat-icon-wrapper">${ICONS.check}</div>
            <div class="stat-number">${statistics?.passed_count || 0}</div>
            <div class="stat-label">${t('common.fullValidation.report.passed')}</div>
          </div>
          <div class="stat-card stat-failed">
            <div class="stat-icon-wrapper">${ICONS.x}</div>
            <div class="stat-number">${statistics?.failed_count || 0}</div>
            <div class="stat-label">${t('common.fullValidation.report.failed')}</div>
          </div>
          <div class="stat-card stat-rate">
            <div class="stat-icon-wrapper">${ICONS.percent}</div>
            <div class="stat-number">${(statistics?.pass_rate || 0).toFixed(1)}%</div>
            <div class="stat-label">${t('common.fullValidation.report.passRate')}</div>
          </div>
        </div>

        <!-- Metrics Grid -->
        <div class="metrics-grid">
          <div class="metric-item">
            <span class="metric-label">${ICONS.folder} ${t('common.fullValidation.report.totalFiles')}</span>
            <span class="metric-value">${summary.files_total}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">${ICONS.database} ${t('common.fullValidation.report.loadedFiles')}</span>
            <span class="metric-value">${summary.files_loaded}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">${ICONS.database} ${t('common.fullValidation.report.tablesLoaded')}</span>
            <span class="metric-value">${summary.tables_loaded}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">${ICONS.alertCircle} ${t('common.fullValidation.report.loadingErrors')}</span>
            <span class="metric-value ${summary.loading_error_count > 0 ? 'text-danger' : 'text-success'}">${summary.loading_error_count}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">${ICONS.layout} ${t('common.fullValidation.report.formatErrors')}</span>
            <span class="metric-value ${summary.format_error_count > 0 ? 'text-danger' : 'text-success'}">${summary.format_error_count}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">${ICONS.barChart} ${t('common.fullValidation.report.constraintErrors')}</span>
            <span class="metric-value ${summary.constraint_error_count > 0 ? 'text-danger' : 'text-success'}">${summary.constraint_error_count}</span>
          </div>
        </div>

      ${
        reportViewModel.failedCount > 0
          ? `
      <!-- Error Details -->
      <div class="section-title">
        ${ICONS.list}
        ${t('common.fullValidation.report.errorDetails')}
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th class="col-stage">${t('common.fullValidation.table.stage')}</th>
              <th class="col-table">${t('common.fullValidation.table.table')}</th>
              <th class="col-column">${t('common.fullValidation.table.column')}</th>
              <th class="col-type">${t('common.fullValidation.table.errorType')}</th>
              <th class="col-msg">${t('common.fullValidation.table.message')}</th>
            </tr>
          </thead>
          <tbody>
            ${errorsHtml}
          </tbody>
        </table>
      </div>
      `
          : ''
      }

      ${
        reportViewModel.passedCount > 0
          ? `
      <!-- Passed Details -->
      <div class="section-title">
        ${ICONS.list}
        ${t('common.fullValidation.report.passedDetails')}
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th class="col-stage">${t('common.fullValidation.table.stage')}</th>
              <th class="col-table">${t('common.fullValidation.table.table')}</th>
              <th class="col-column">${t('common.fullValidation.table.column')}</th>
              <th class="col-type">${t('common.fullValidation.table.checkType')}</th>
              <th class="col-msg">${t('common.fullValidation.table.message')}</th>
            </tr>
          </thead>
          <tbody>
            ${passedHtml}
          </tbody>
        </table>
      </div>
      `
          : ''
      }

      ${
        reportViewModel.allCount === 0
          ? `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        <p>${t('common.fullValidation.report.noResults')}</p>
      </div>
      `
          : ''
      }
      </div>

      <!-- Footer -->
      <div class="report-footer">
        <p>${t('common.fullValidation.report.title')} · <span class="report-footer-brand">Precis</span></p>
      </div>
    </div>
  </div>
</body>
</html>`
}

/**
 * 导出 HTML 报告并触发下载
 *
 * @param data 校验结果数据
 * @param options 导出选项
 */

/**
 * @file reportStyles.ts
 * @description 校验报告 CSS 样式
 *
 * 职责：
 * - 定义报告 HTML 的内联 CSS 样式
 * - 支持打印友好（print media query）
 * - 响应式布局支持
 *
 * 设计特点：
 * - CSS 变量统一管理主题色
 * - 打印时保留关键颜色（-webkit-print-color-adjust: exact）
 */

export const REPORT_CSS = `  <style>
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --ui-accent: #3B82F6;
  --ui-accent-strong: #2563EB;
  --ui-accent-weak: rgba(59, 130, 246, 0.12);
  --ui-accent-ring: rgba(59, 130, 246, 0.2);

  --ui-success: #10B981;
  --ui-success-strong: #059669;
  --ui-success-weak: rgba(16, 185, 129, 0.12);

  --ui-warning: #F59E0B;
  --ui-warning-strong: #D97706;
  --ui-warning-weak: rgba(245, 158, 11, 0.12);

  --ui-danger: #EF4444;
  --ui-danger-strong: #DC2626;
  --ui-danger-weak: rgba(239, 68, 68, 0.12);

  --ui-bg-base: #F8FAFC;
  --ui-bg-elevated: #FFFFFF;
  --ui-bg-subtle: #F1F5F9;
  --ui-border-subtle: #E2E8F0;
  --ui-border-light: #CBD5E1;
  --ui-text-primary: #0F172A;
  --ui-text-secondary: #64748B;
  --ui-text-tertiary: #94A3B8;
  --ui-text-muted: #CBD5E1;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: var(--ui-bg-base);
  line-height: 1.5;
  color: var(--ui-text-secondary);
  -webkit-font-smoothing: antialiased;
}

.report-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-xl);
}

.report-shell {
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

/* Header Section - Professional Light Theme */
.report-header {
  background: var(--ui-bg-elevated);
  border-bottom: 3px solid var(--ui-accent);
  padding: var(--space-xl) var(--space-2xl);
  position: relative;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--space-lg);
}

.header-title-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.project-name {
  font-size: 22px;
  font-weight: 700;
  color: var(--ui-text-primary);
  letter-spacing: -0.3px;
  line-height: 1.3;
}

.report-subtitle {
  font-size: 14px;
  color: var(--ui-text-tertiary);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  line-height: 1.4;
}

.report-subtitle svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.status-badge.success {
  background: var(--ui-success-weak);
  color: var(--ui-success-strong);
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.status-badge.error {
  background: var(--ui-danger-weak);
  color: var(--ui-danger-strong);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.status-icon {
  width: 18px;
  height: 18px;
}

.header-meta {
  display: flex;
  gap: var(--space-2xl);
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.meta-label {
  font-size: 11px;
  color: var(--ui-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.meta-label svg {
  width: 12px;
  height: 12px;
}

.meta-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--ui-text-primary);
  font-variant-numeric: tabular-nums;
}

/* Main Stats Cards - 2x2 Grid */
.stats-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-lg);
  margin-bottom: var(--space-xl);
  padding: 0 var(--space-2xl);
  margin-top: var(--space-xl);
}

.stat-card {
  padding: var(--space-lg);
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-md);
}

.stat-icon-wrapper svg {
  width: 20px;
  height: 20px;
}

.stat-total .stat-icon-wrapper {
  background: var(--ui-accent-weak);
  color: var(--ui-accent-strong);
}

.stat-passed .stat-icon-wrapper {
  background: var(--ui-success-weak);
  color: var(--ui-success-strong);
}

.stat-failed .stat-icon-wrapper {
  background: var(--ui-danger-weak);
  color: var(--ui-danger-strong);
}

.stat-rate .stat-icon-wrapper {
  background: var(--ui-warning-weak);
  color: var(--ui-warning-strong);
}

.stat-number {
  font-size: 28px;
  font-weight: 700;
  color: var(--ui-text-primary);
  line-height: 1.2;
  margin-bottom: var(--space-xs);
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 12px;
  color: var(--ui-text-tertiary);
  font-weight: 500;
}

/* Content Area */
.report-body {
  padding: 0 var(--space-2xl) var(--space-2xl);
}

/* Metrics Grid - 3x2 Compact */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}

.metric-item {
  background: var(--ui-bg-subtle);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md) var(--space-lg);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.metric-label {
  font-size: 12px;
  color: var(--ui-text-tertiary);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.metric-label svg {
  width: 14px;
  height: 14px;
  color: var(--ui-text-muted);
}

.metric-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--ui-text-primary);
  font-variant-numeric: tabular-nums;
}

.metric-value.text-danger {
  color: var(--ui-danger-strong);
}

.metric-value.text-success {
  color: var(--ui-success-strong);
}

/* Section Title */
.section-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 15px;
  font-weight: 600;
  color: var(--ui-text-primary);
  margin: var(--space-xl) 0 var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--ui-border-subtle);
}

.section-title svg {
  width: 18px;
  height: 18px;
  color: var(--ui-text-tertiary);
}

/* Results Table */
.table-container {
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: var(--space-xl);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table thead {
  background: var(--ui-bg-base);
}

.data-table th {
  padding: var(--space-md) var(--space-lg);
  text-align: left;
  font-weight: 600;
  color: var(--ui-text-secondary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--ui-border-subtle);
}

.data-table td {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--ui-border-subtle);
  vertical-align: top;
}

.data-table tbody tr:last-child td {
  border-bottom: none;
}

.data-table tbody tr:hover {
  background: var(--ui-bg-subtle);
}

.data-table tbody tr:nth-child(even) {
  background: #FAFBFC;
}

.col-num {
  width: 50px;
  color: var(--ui-text-muted);
  font-weight: 500;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.col-stage {
  width: 100px;
}

.col-table {
  width: 120px;
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  color: var(--ui-text-primary);
}

.col-column {
  width: 100px;
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  color: var(--ui-text-primary);
}

.col-type {
  width: 140px;
}

.col-msg {
  min-width: 250px;
}

/* Badges - Low Saturation Design */
.stage-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.stage-loading {
  background: var(--ui-accent-weak);
  color: var(--ui-accent-strong);
}

.stage-format {
  background: var(--ui-warning-weak);
  color: var(--ui-warning-strong);
}

.stage-constraint {
  background: #FCE7F3;
  color: #BE185D;
}

.stage-regex {
  background: #EDE9FE;
  color: #7C3AED;
}

.type-code {
  background: var(--ui-bg-subtle);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'Monaco', 'Consolas', monospace;
  color: var(--ui-text-secondary);
}

.message-content {
  line-height: 1.5;
  color: var(--ui-text-primary);
  font-size: 13px;
}

.message-path {
  font-size: 11px;
  color: var(--ui-text-tertiary);
  margin-top: var(--space-xs);
  font-family: 'Monaco', 'Consolas', monospace;
}

/* Row Styles - Subtle Border */
.error-row {
  border-left: 3px solid var(--ui-danger);
}

.error-row td {
  background: rgba(239, 68, 68, 0.02);
}

.passed-row {
  border-left: 3px solid var(--ui-success);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: var(--space-2xl);
  color: var(--ui-text-tertiary);
}

.empty-state svg {
  width: 48px;
  height: 48px;
  margin-bottom: var(--space-md);
  opacity: 0.4;
}

/* Footer */
.report-footer {
  background: var(--ui-bg-base);
  padding: var(--space-lg) var(--space-2xl);
  text-align: center;
  border-top: 1px solid var(--ui-border-subtle);
  color: var(--ui-text-tertiary);
  font-size: 12px;
}

.report-footer-brand {
  font-weight: 600;
  color: var(--ui-accent);
}

/* Print Styles - PDF Friendly */
@media print {
  body {
    background: white;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .report-container {
    max-width: 100%;
    padding: 0;
  }
  .report-shell {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
  .report-header {
    background: white !important;
    border-bottom: 2px solid var(--ui-accent) !important;
    padding: var(--space-lg);
  }
  .stat-icon-wrapper {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .stage-badge {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .error-row {
    border-left: 2px solid var(--ui-danger) !important;
  }
  .passed-row {
    border-left: 2px solid var(--ui-success) !important;
  }
  .table-container {
    box-shadow: none;
    border: 1px solid var(--ui-border-subtle);
  }
}

/* Responsive */
@media (max-width: 1024px) {
  .stats-overview {
    grid-template-columns: repeat(2, 1fr);
  }
  .metrics-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .report-container { padding: var(--space-lg); }
  .report-header { padding: var(--space-lg); }
  .report-body { padding: 0 var(--space-lg) var(--space-lg); }
  .header-top { flex-direction: column; gap: var(--space-md); }
  .header-meta { flex-direction: column; gap: var(--space-md); }
  .stats-overview {
    grid-template-columns: 1fr;
    padding: 0;
    margin-top: var(--space-lg);
  }
  .metrics-grid { grid-template-columns: 1fr; }
  .data-table { font-size: 12px; }
  .data-table th, .data-table td { padding: 10px 8px; }
}
  </style>
`

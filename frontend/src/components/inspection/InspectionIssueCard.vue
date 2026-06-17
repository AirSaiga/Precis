<!--
  @file InspectionIssueCard.vue
  @description 单条配置自检问题卡片

  展示结构（自上而下）:
  1. 头部：严重度图标 + 标题 + 单条忽略按钮
  2. 根因说明（一句话）
  3. 修复建议（高亮）
  4. 动作按钮（打开文件 / 一键修复 / 复制 / 忽略）
  5. 上下文数据（如果有）：可用表 / 可用列（可点击直接修正引用）
  6. 原始信息（兜底）

  i18n 渲染策略：
  - issue.title_key / description_key / fix_hint_key 存在时优先用 i18n 渲染
  - action.label_key 存在时优先用 i18n 渲染
  - 否则 fallback 到对应中文字符串字段（后端 fallback 已是业务语言）

  视觉: 左侧色条 + 严重度背景色，按严重度区分（blocker 红色 / warning 黄色）
-->
<template>
  <article class="issue-card" :class="[`severity-${issue.severity}`, { 'is-ignored': ignored }]">
    <div class="card-color-bar" :class="`bar-${issue.severity}`"></div>

    <div class="card-body">
      <header class="card-header">
        <span class="severity-icon" :class="`icon-${issue.severity}`">{{ icon }}</span>
        <h4 class="card-title">{{ titleText }}</h4>
        <span class="severity-tag" :class="`tag-${issue.severity}`">
          {{ severityLabel }}
        </span>
        <button
          v-if="!ignored"
          class="dismiss-btn"
          :title="t('inspection.action.dismiss')"
          @click="$emit('dismiss', issue.id)"
        >
          <span class="dismiss-icon">×</span>
          <span class="dismiss-label">{{ t('inspection.action.dismissShort') }}</span>
        </button>
        <button
          v-else
          class="restore-btn"
          :title="t('inspection.action.restore')"
          @click="$emit('restore', issue.id)"
        >
          {{ t('inspection.action.restore') }}
        </button>
      </header>

      <p v-if="descriptionText" class="card-description">{{ descriptionText }}</p>

      <!-- 修复建议（高亮） -->
      <div v-if="fixHintText" class="fix-hint">
        <span class="section-label">💡</span>
        <span class="hint-text">{{ fixHintText }}</span>
      </div>

      <!-- 动作按钮 -->
      <div v-if="issue.actions.length > 0" class="card-actions">
        <button
          v-for="(action, idx) in issue.actions"
          :key="idx"
          :class="['action-btn', `action-${action.type}`]"
          :disabled="action.type === 'auto_fix' && fixing"
          @click="$emit('action', issue, action)"
        >
          <span v-if="action.type === 'auto_fix' && fixing" class="spinner"></span>
          <span v-else class="action-icon">{{ iconForAction(action.type) }}</span>
          <span class="action-label">{{ actionLabel(action) }}</span>
        </button>
      </div>

      <!-- 上下文：可用表列表（用于 FK 悬挂 / 表不存在） -->
      <div
        v-if="availableSchemas.length > 0"
        class="context-block"
        :title="t('inspection.context.availableSchemas')"
      >
        <div class="context-label">💡 {{ t('inspection.context.availableSchemas') }}</div>
        <ul class="schema-list">
          <li v-for="schema in availableSchemas" :key="schema.id" class="schema-item">
            <span class="schema-name">{{ schema.name || schema.id }}</span>
            <div v-if="schema.name && schema.id !== schema.name" class="schema-id-row">
              <code class="schema-id">{{ schema.id }}</code>
              <button
                class="schema-copy-btn"
                :title="t('inspection.actions.copyId')"
                @click="handleCopyId(schema.id)"
              >
                📋
              </button>
            </div>
            <button
              class="fix-select-btn"
              :title="t('inspection.actions.selectFix')"
              @click="fixTableRef(schema.id)"
            >
              {{ t('inspection.actions.selectFix') }}
            </button>
          </li>
        </ul>
      </div>

      <!-- 上下文：可用列列表（用于列不存在） -->
      <div
        v-if="availableColumns.length > 0"
        class="context-block"
        :title="t('inspection.context.availableColumns')"
      >
        <div class="context-label">💡 {{ t('inspection.context.availableColumns') }}</div>
        <div class="column-chips">
          <button
            v-for="col in availableColumns"
            :key="col"
            class="column-chip-fix"
            :title="t('inspection.actions.selectFix')"
            @click="fixColumnRef(col)"
          >
            {{ col }}
          </button>
        </div>
      </div>

      <!-- 兜底：原始 message（高级用户排查用）。
           当 message 已被用作 title/description 兜底时隐藏，避免重复展示 -->
      <details
        v-if="issue.message && issue.message !== titleText && issue.message !== descriptionText"
        class="raw-message"
      >
        <summary>{{ t('inspection.rawDetails') }}</summary>
        <pre>{{ issue.message }}</pre>
        <div v-if="issue.error_type" class="raw-meta">
          {{ t('inspection.errorType') }}: <code>{{ issue.error_type }}</code>
          <span v-if="issue.file_path">
            · {{ t('inspection.filePath') }}: <code>{{ issue.file_path }}</code>
          </span>
        </div>
      </details>
    </div>
  </article>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { InspectionAction, InspectionIssue } from '@/types/projectV2'
  import { useClipboard } from '@/composables/useClipboard'
  import { toastSuccess, toastError } from '@/core/toast'

  const props = defineProps<{
    issue: InspectionIssue
    ignored?: boolean
    fixing?: boolean
  }>()

  const emit = defineEmits<{
    dismiss: [issueId: string]
    restore: [issueId: string]
    action: [issue: InspectionIssue, action: InspectionAction]
    /** 用户从可用表列表中选择一个表来修正引用 */
    selectFixTable: [issue: InspectionIssue, newTableId: string]
    /** 用户从可用列列表中选择一个列来修正引用 */
    selectFixColumn: [issue: InspectionIssue, newColumnId: string]
  }>()

  const { t } = useI18n()
  const { copy } = useClipboard()

  const SEVERITY_ICONS: Record<string, string> = {
    blocker: '🔴',
    warning: '⚠️',
    info: 'ℹ️',
  }

  const ACTION_ICONS: Record<string, string> = {
    open_file: '📂',
    copy: '📋',
    dismiss: '🔕',
    auto_fix: '🛠️',
    navigate: '➡️',
  }

  const icon = computed(() => SEVERITY_ICONS[props.issue.severity] ?? '⚠️')

  const severityLabel = computed(
    () => t(`inspection.severity.${props.issue.severity}`) ?? props.issue.severity
  )

  function iconForAction(type: string): string {
    return ACTION_ICONS[type] ?? '▸'
  }

  /**
   * i18n 渲染 helper
   * - 有 key 时用 t(key, params)
   * - 否则 fallback 到原字符串
   */
  function renderText(
    key: string | undefined,
    fallback: string,
    params?: Record<string, unknown>
  ): string {
    if (key) {
      return t(key, params ?? {})
    }
    return fallback
  }

  /**
   * 预处理 message_params：把面向用户的文案里可能出现的 tableId/columnId
   * 转成最友好的形式，避免暴露 UUID/编码串等对用户无意义的 id。
   *
   * tableId 的取值优先级（体现"优先用 name"原则）：
   *   1. tableName 非空 → 用 name（表存在时后端会填 schema.name，最可读）
   *   2. 否则若 id 是机器生成 → 用本地化中性词（machineIdLabel.table）
   *   3. 否则（可读 id 如 "users"）→ 原样保留
   * columnId 同理（列已删除时无 name 来源，机器 id 走中性词）。
   *
   * 原始 id 仍保留在 issue.message（折叠区）供高级用户排查。
   */
  const displayMessageParams = computed<Record<string, unknown>>(() => {
    const raw = props.issue.message_params ?? {}
    const params: Record<string, unknown> = { ...raw }
    // tableId：优先 name
    if (typeof raw.tableName === 'string' && raw.tableName.trim()) {
      params.tableId = raw.tableName
    } else if (raw.tableIdIsMachine && typeof raw.tableId === 'string') {
      params.tableId = t('inspection.machineIdLabel.table')
    }
    // columnId：无 name 来源，机器 id 走中性词
    if (raw.columnIdIsMachine && typeof raw.columnId === 'string') {
      params.columnId = t('inspection.machineIdLabel.column')
    }
    return params
  })

  const titleText = computed(() => {
    const rendered = renderText(props.issue.title_key, props.issue.title, displayMessageParams.value)
    // title 和 key 都空时，回退到 error_type 或通用文案，避免卡片出现空白主标题
    if (rendered) return rendered
    if (props.issue.error_type) return props.issue.error_type
    return t('inspection.issues.untitled')
  })

  const descriptionText = computed(() => {
    const rendered = renderText(
      props.issue.description_key,
      props.issue.description,
      displayMessageParams.value
    )
    // description 空时回退到 message（兜底），保证用户至少能看到一句说明
    return rendered || props.issue.message || ''
  })

  const fixHintText = computed(() =>
    renderText(props.issue.fix_hint_key, props.issue.fix_hint, displayMessageParams.value)
  )

  function actionLabel(action: InspectionAction): string {
    return renderText(action.label_key, action.label)
  }

  /** 上下文中的可用表列表（用于 FK 悬挂 / 表不存在） */
  const availableSchemas = computed<Array<{ id: string; name: string }>>(() => {
    const ctx = props.issue.context as Record<string, unknown> | undefined
    const list = ctx?.available_schemas
    if (!Array.isArray(list)) return []
    return list.filter(
      (x): x is { id: string; name: string } =>
        typeof x === 'object' && x !== null && typeof (x as any).id === 'string'
    )
  })

  /** 上下文中的可用列列表（用于列不存在） */
  const availableColumns = computed<string[]>(() => {
    const ctx = props.issue.context as Record<string, unknown> | undefined
    const list = ctx?.available_columns
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  })

  /** 复制 schema id 到剪贴板 */
  async function handleCopyId(id: string): Promise<void> {
    try {
      await copy(id)
      toastSuccess(t('inspection.toast.copied'), '')
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err), '')
    }
  }

  /** 点击可用表条目，请求修正当前 issue 的表引用 */
  function fixTableRef(schemaId: string): void {
    emit('selectFixTable', props.issue, schemaId)
  }

  /** 点击可用列条目，请求修正当前 issue 的列引用 */
  function fixColumnRef(col: string): void {
    emit('selectFixColumn', props.issue, col)
  }
</script>

<style scoped>
  .issue-card {
    position: relative;
    display: flex;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-elevated);
    overflow: hidden;
    transition: opacity 0.2s;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }
  .issue-card * {
    user-select: text;
    -webkit-user-select: text;
  }
  .issue-card button,
  .issue-card summary {
    user-select: none;
    -webkit-user-select: none;
    cursor: pointer;
  }

  .issue-card.is-ignored {
    opacity: 0.5;
  }

  .card-color-bar {
    flex-shrink: 0;
    width: 4px;
    background: var(--ui-border);
  }

  .bar-blocker {
    background: var(--ui-danger, #ef4444);
  }
  .bar-warning {
    background: var(--ui-warning, #f59e0b);
  }
  .bar-info {
    background: var(--ui-info, #3b82f6);
  }

  .card-body {
    flex: 1;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .severity-icon {
    font-size: 16px;
    line-height: 1;
  }
  .icon-blocker {
    color: var(--ui-danger, #ef4444);
  }
  .icon-warning {
    color: var(--ui-warning, #f59e0b);
  }
  .icon-info {
    color: var(--ui-info, #3b82f6);
  }

  .card-title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--ui-text);
    flex: 1;
    min-width: 0;
  }

  .severity-tag {
    display: inline-flex;
    align-items: center;
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.5;
  }
  .tag-blocker {
    background: var(--ui-danger-subtle, rgba(239, 68, 68, 0.12));
    color: var(--ui-danger, #ef4444);
  }
  .tag-warning {
    background: var(--ui-warning-subtle, rgba(245, 158, 11, 0.12));
    color: var(--ui-warning, #f59e0b);
  }
  .tag-info {
    background: var(--ui-info-subtle, rgba(59, 130, 246, 0.12));
    color: var(--ui-info, #3b82f6);
  }

  .dismiss-btn,
  .restore-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-muted);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .dismiss-btn:hover {
    border-color: var(--ui-text-muted);
    color: var(--ui-text);
  }
  .restore-btn {
    border-color: var(--ui-info, #3b82f6);
    color: var(--ui-info, #3b82f6);
  }
  .restore-btn:hover {
    background: var(--ui-info-subtle, rgba(59, 130, 246, 0.08));
  }
  .dismiss-icon {
    font-size: 14px;
    line-height: 1;
  }

  .card-description {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--ui-text-muted);
  }

  .context-block {
    background: var(--ui-bg-panel, rgba(0, 0, 0, 0.02));
    border: 1px solid var(--ui-border-subtle, rgba(0, 0, 0, 0.06));
    border-radius: var(--ui-radius-sm);
    padding: 8px 10px;
  }

  .context-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--ui-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }

  .schema-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .schema-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: var(--ui-bg-base);
    border: 1px solid var(--ui-border-subtle, rgba(0, 0, 0, 0.06));
    border-radius: var(--ui-radius-sm);
  }
  .schema-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
    line-height: 1.4;
    word-break: break-all;
  }
  .schema-id-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .schema-id {
    flex: 1;
    font-family: monospace;
    font-size: 10px;
    color: var(--ui-text-subtle);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .schema-item:hover .schema-copy-btn {
    opacity: 1;
  }
  .schema-copy-btn {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-muted);
    font-size: 11px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s;
  }
  .schema-copy-btn:hover {
    background: var(--ui-bg-elevated);
    border-color: var(--ui-border);
    color: var(--ui-text);
    opacity: 1;
  }

  .fix-select-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px 10px;
    margin-top: 2px;
    align-self: flex-start;
    background: var(--ui-accent, #3b82f6);
    border: 1px solid var(--ui-accent, #3b82f6);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-on-accent, #fff);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .fix-select-btn:hover {
    background: var(--ui-accent-hover, #2563eb);
    border-color: var(--ui-accent-hover, #2563eb);
  }

  .column-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .column-chip-fix {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    background: var(--ui-bg-base);
    border: 1px solid var(--ui-border-subtle, rgba(0, 0, 0, 0.06));
    border-radius: var(--ui-radius-sm);
    font-family: monospace;
    font-size: 11px;
    color: var(--ui-text);
    cursor: pointer;
    transition: all 0.15s;
  }
  .column-chip-fix:hover {
    border-color: var(--ui-accent, #3b82f6);
    color: var(--ui-accent, #3b82f6);
  }

  .fix-hint {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 8px 10px;
    background: linear-gradient(
      90deg,
      var(--ui-accent-subtle, rgba(59, 130, 246, 0.08)) 0%,
      transparent 100%
    );
    border-left: 2px solid var(--ui-accent, #3b82f6);
    border-radius: var(--ui-radius-sm);
    font-size: 13px;
    line-height: 1.5;
    color: var(--ui-text);
  }
  .section-label {
    flex-shrink: 0;
  }
  .hint-text {
    flex: 1;
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: var(--ui-bg-base);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .action-btn:hover:not(:disabled) {
    border-color: var(--ui-accent, #3b82f6);
    color: var(--ui-accent, #3b82f6);
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-auto_fix {
    background: var(--ui-accent, #3b82f6);
    color: var(--ui-text-on-accent, #fff);
    border-color: var(--ui-accent, #3b82f6);
  }
  .action-auto_fix:hover:not(:disabled) {
    background: var(--ui-accent-hover, #2563eb);
    border-color: var(--ui-accent-hover, #2563eb);
    color: var(--ui-text-on-accent, #fff);
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .raw-message {
    margin-top: 4px;
    font-size: 12px;
    color: var(--ui-text-subtle);
  }
  .raw-message summary {
    cursor: pointer;
    user-select: none;
    list-style: none;
  }
  .raw-message summary::-webkit-details-marker {
    display: none;
  }
  .raw-message summary::before {
    content: '▶';
    display: inline-block;
    margin-right: 4px;
    font-size: 9px;
    transition: transform 0.15s;
  }
  .raw-message[open] summary::before {
    transform: rotate(90deg);
  }
  .raw-message pre {
    margin: 6px 0 0;
    padding: 6px 8px;
    background: var(--ui-bg-base);
    border-radius: var(--ui-radius-sm);
    font-family: monospace;
    font-size: 11px;
    color: var(--ui-text-muted);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .raw-meta {
    margin-top: 4px;
    color: var(--ui-text-subtle);
  }
  .raw-meta code {
    font-family: monospace;
    font-size: 11px;
  }
</style>

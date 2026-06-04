<!--
  @file InspectionDrawer.vue
  @description 配置自检抽屉（右侧滑出）

  职责:
  - 展示当前自检结果，按用户选择的维度分组（按文件 / 按严重度）
  - 支持单条忽略 / 整组忽略
  - 支持动作按钮（打开文件 / 复制 / 一键修复）
  - 提供"重新检查" / "管理忽略项" / "全部展开" 工具栏
  - 空状态：全部修好后显示 🎉
-->
<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div
        v-if="store.drawerVisible"
        class="inspection-drawer"
        @click.self="store.closeDrawer()"
      >
        <aside class="drawer-panel" role="dialog" :aria-label="t('inspection.title')">
          <header class="drawer-header">
            <h3 class="drawer-title">
              {{ t('inspection.title') }}
            </h3>
            <div class="header-actions">
              <button
                class="header-btn"
                :title="t('inspection.action.recheck')"
                :disabled="isRechecking"
                @click="recheck"
              >
                <span v-if="isRechecking" class="spinner-small"></span>
                <span v-else>⟳</span>
              </button>
              <button
                class="header-btn"
                :title="t('inspection.action.manageIgnored')"
                @click="showIgnoredManager = true"
              >
                🔕
              </button>
              <button
                class="header-btn"
                :title="t('inspection.action.copyAll')"
                @click="copyAll"
              >
                📋
              </button>
              <button
                class="header-btn close"
                :title="t('common.close')"
                @click="store.closeDrawer()"
              >
                ×
              </button>
            </div>
          </header>

          <InspectionSummaryCard
            :unresolved-count="store.unresolvedCount"
            :total-count="store.allIssues.length"
            :ignored-count="store.ignoredIds.size"
            :last-checked-at="store.currentResult?.inspected_at ?? null"
            :is-pass="store.unresolvedCount === 0"
            :blocker-count="severityCounts.blocker"
            :warning-count="severityCounts.warning"
            :info-count="severityCounts.info"
            @recheck="recheck"
            @expand-all="expandAll"
            @copy-all="copyAll"
          />

          <div v-if="store.unresolvedCount > 0" class="group-tabs">
            <button
              :class="{ active: store.groupBy === 'file' }"
              @click="store.setGroupBy('file')"
            >
              {{ t('inspection.groupBy.file') }}
            </button>
            <button
              :class="{ active: store.groupBy === 'severity' }"
              @click="store.setGroupBy('severity')"
            >
              {{ t('inspection.groupBy.severity') }}
            </button>
            <button class="expand-all" @click="expandAll">
              {{ t('inspection.action.expandAll') }}
            </button>
          </div>

          <div class="drawer-body">
            <!-- 全部修好 / 无问题 -->
            <div
              v-if="store.unresolvedCount === 0 && store.allIssues.length === 0"
              class="empty-state"
            >
              <div class="empty-icon">🎉</div>
              <h4 class="empty-title">{{ t('inspection.empty.passedTitle') }}</h4>
              <p class="empty-desc">{{ t('inspection.empty.passedDesc') }}</p>
            </div>

            <div
              v-else-if="store.unresolvedCount === 0 && store.allIssues.length > 0"
              class="empty-state"
            >
              <div class="empty-icon">🔕</div>
              <h4 class="empty-title">{{ t('inspection.empty.allIgnoredTitle') }}</h4>
              <p class="empty-desc">
                {{ t('inspection.empty.allIgnoredDesc', { count: store.allIssues.length }) }}
              </p>
              <button class="empty-action" @click="showIgnoredManager = true">
                {{ t('inspection.action.manageIgnored') }}
              </button>
            </div>

            <!-- 问题列表 -->
            <InspectionIssueGroup
              v-for="group in groups"
              :key="group.key"
              :group="group"
              :ignored-ids="store.ignoredIds"
              :fixing-ids="store.fixingIds"
              :default-expanded="defaultExpanded"
              @dismiss="store.dismiss"
              @restore="store.restore"
              @dismiss-group="dismissGroup"
              @action="handleAction"
            />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <InspectionIgnoredManager
      v-if="showIgnoredManager"
      :visible="showIgnoredManager"
      @close="showIgnoredManager = false"
    />
  </Teleport>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useInspectionStore } from '@/stores/inspectionStore'
  import { inspectV2Config } from '@/api/projectV2Api'
  import { useProjectStore } from '@/stores/projectStore'
  import { logger } from '@/core/utils/logger'
  import { toastError, toastSuccess } from '@/core/toast'
  import { useClipboard } from '@/composables/useClipboard'
  import InspectionSummaryCard from './InspectionSummaryCard.vue'
  import InspectionIssueGroup, { type IssueGroup } from './InspectionIssueGroup.vue'
  import InspectionIgnoredManager from './InspectionIgnoredManager.vue'
  import type { InspectionAction, InspectionIssue } from '@/types/projectV2'

  const store = useInspectionStore()
  const projectStore = useProjectStore()
  const { t } = useI18n()
  const { copy: copyToClipboard } = useClipboard()

  const isRechecking = ref(false)
  const showIgnoredManager = ref(false)
  /** 临时强制全部展开（点击"全部展开"按钮） */
  const forceExpandAll = ref(false)

  const severityCounts = computed(() => {
    const issues = store.unresolvedIssues
    let blocker = 0
    let warning = 0
    let info = 0
    for (const i of issues) {
      if (i.severity === 'blocker') blocker++
      else if (i.severity === 'warning') warning++
      else info++
    }
    return { blocker, warning, info }
  })

  const defaultExpanded = computed(() => forceExpandAll.value)

  /**
   * 把问题列表按当前 groupBy 模式分组
   */
  const groups = computed<IssueGroup[]>(() => {
    const issues = store.unresolvedIssues
    if (issues.length === 0) return []

    if (store.groupBy === 'severity') {
      // 按严重度分三组
      const SEVERITY_ORDER: Array<'blocker' | 'warning' | 'info'> = ['blocker', 'warning', 'info']
      const SEVERITY_LABEL_KEY: Record<string, string> = {
        blocker: 'blocker',
        warning: 'warning',
        info: 'info',
      }
      return SEVERITY_ORDER.flatMap((severity) => {
        const group = issues.filter((i) => i.severity === severity)
        if (group.length === 0) return []
        return [
          {
            key: `severity-${severity}`,
            title: t(`inspection.severity.${SEVERITY_LABEL_KEY[severity]}`),
            severity,
            issues: group,
          },
        ]
      })
    }

    // 默认按文件分组
    const byFile = new Map<string, InspectionIssue[]>()
    for (const issue of issues) {
      const key = issue.file_path || '<unknown>'
      if (!byFile.has(key)) byFile.set(key, [])
      byFile.get(key)!.push(issue)
    }

    return [...byFile.entries()]
      .map(([filePath, list]) => {
        // 找该文件组内最高严重度
        let severity: 'blocker' | 'warning' | 'info' = 'info'
        if (list.some((i) => i.severity === 'blocker')) severity = 'blocker'
        else if (list.some((i) => i.severity === 'warning')) severity = 'warning'
        return {
          key: `file-${filePath}`,
          title: filePath || t('inspection.unknownFile'),
          severity,
          issues: list,
        }
      })
      .sort((a, b) => {
        // blocker 文件组排在最前
        const order = { blocker: 0, warning: 1, info: 2 }
        return order[a.severity] - order[b.severity]
      })
  })

  /** 重新执行自检 */
  async function recheck(): Promise<void> {
    if (isRechecking.value) return
    const path = projectStore.currentPaths?.configPath
    if (!path) {
      toastError(t('inspection.errors.noProject'), t('inspection.title'))
      return
    }
    isRechecking.value = true
    try {
      const result = await inspectV2Config(path)
      store.setResult(result, { autoOpen: false })
      toastSuccess(
        t('inspection.toast.recheckDone', { count: result.errors.length }),
        t('inspection.title')
      )
    } catch (err) {
      logger.error('[InspectionDrawer] 重新检查失败:', err)
      toastError(
        err instanceof Error ? err.message : t('common.unknownError'),
        t('inspection.toast.recheckFailed')
      )
    } finally {
      isRechecking.value = false
    }
  }

  /** 全部展开 */
  function expandAll(): void {
    forceExpandAll.value = true
  }

  /** 整组忽略 */
  function dismissGroup(issueIds: string[]): void {
    for (const id of issueIds) {
      store.dismiss(id)
    }
  }

  /**
   * 处理 issue 卡片上的动作按钮
   *
   * 支持的动作:
   * - open_file : 调 Electron IPC 打开本地文件（无 Electron 时 fallback 复制路径）
   * - copy      : 复制文本到剪贴板
   * - dismiss   : 调 store.dismiss（卡片头部已有按钮，但 actions 列表里也可携带）
   * - auto_fix  : 调后端 fix_api 执行一键修复
   * - navigate  : 跳转到其他位置（暂未实现完整跳转）
   */
  async function handleAction(issue: InspectionIssue, action: InspectionAction): Promise<void> {
    switch (action.type) {
      case 'open_file': {
        const path = action.file_path || issue.file_path
        if (!path) return
        await openFile(path)
        break
      }
      case 'copy': {
        const text = action.text || action.file_path || issue.ref_id || ''
        if (text) {
          await copyToClipboard(text)
          toastSuccess(t('inspection.toast.copied'), '')
        }
        break
      }
      case 'dismiss': {
        store.dismiss(issue.id)
        break
      }
      case 'auto_fix': {
        await runAutoFix(issue)
        break
      }
      case 'navigate': {
        logger.warn('[InspectionDrawer] navigate 动作暂未实现:', action)
        break
      }
    }
  }

  /**
   * 调 Electron 打开本地文件
   *
   * - Electron 模式: window.electronAPI.openInEditor(path)
   * - 浏览器模式: fallback 到复制路径
   */
  async function openFile(path: string): Promise<void> {
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.openInEditor) {
      try {
        await electronAPI.openInEditor(path)
        return
      } catch (err) {
        logger.warn('[InspectionDrawer] Electron 打开文件失败，回退到复制路径:', err)
      }
    }
    // 回退：复制路径
    await copyToClipboard(path)
    toastSuccess(t('inspection.toast.pathCopied'), t('inspection.action.openFile'))
  }

  /**
   * 执行 auto_fix
   *
   * 当前已实现的 fix_kind:
   * - deduplicate_constraint_refs: 删除 manifest 中的重复 constraint 引用
   */
  async function runAutoFix(issue: InspectionIssue): Promise<void> {
    if (!issue.fix_api) {
      toastError(t('inspection.errors.noFixApi'), t('inspection.title'))
      return
    }
    const path = projectStore.currentPaths?.configPath
    if (!path) {
      toastError(t('inspection.errors.noProject'), t('inspection.title'))
      return
    }
    store.markFixing(issue.id, true)
    try {
      const apiClient = (await import('@/core/services/httpClient')).default
      const { data } = await apiClient.request({
        method: issue.fix_api.method,
        url: issue.fix_api.path,
        data: issue.fix_api.body,
        headers: { 'X-Project-Config-Path': path },
      })
      logger.info('[InspectionDrawer] auto_fix 成功:', data)
      toastSuccess(t('inspection.toast.fixDone'), t('inspection.title'))
      // 自动重新检查
      await recheck()
    } catch (err) {
      logger.error('[InspectionDrawer] auto_fix 失败:', err)
      toastError(
        err instanceof Error ? err.message : t('common.unknownError'),
        t('inspection.toast.fixFailed')
      )
    } finally {
      store.markFixing(issue.id, false)
    }
  }

  /** 复制所有问题为 markdown */
  async function copyAll(): Promise<void> {
    const issues = store.unresolvedIssues
    if (issues.length === 0) {
      toastSuccess(t('inspection.toast.nothingToCopy'), '')
      return
    }
    const lines: string[] = [`# ${t('inspection.title')}`, '']
    for (const issue of issues) {
      lines.push(
        `## [${issue.severity.toUpperCase()}] ${issue.title}`,
        ``,
        `- ${t('inspection.copyAll.file')}: \`${issue.file_path || 'N/A'}\``,
        `- ${t('inspection.copyAll.refId')}: \`${issue.ref_id || 'N/A'}\``,
        ``,
        `${issue.description}`,
        ``,
        `💡 ${issue.fix_hint}`,
        ``,
        '---',
        ``
      )
    }
    await copyToClipboard(lines.join('\n'))
    toastSuccess(t('inspection.toast.allCopied', { count: issues.length }), t('inspection.title'))
  }
</script>

<style scoped>
  .inspection-drawer {
    position: fixed;
    inset: 0;
    background: var(--ui-overlay-backdrop, rgba(0, 0, 0, 0.3));
    display: flex;
    align-items: stretch;
    justify-content: flex-end;
    z-index: 25000;
    backdrop-filter: blur(2px);
  }

  .drawer-panel {
    background: var(--ui-bg-base);
    width: 560px;
    max-width: 95vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.15);
    border-left: 1px solid var(--ui-border);
    overflow: hidden;
  }

  .drawer-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-bg-elevated);
  }

  .drawer-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--ui-text);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .header-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-muted);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .header-btn:hover:not(:disabled) {
    background: var(--ui-bg-base);
    border-color: var(--ui-border);
    color: var(--ui-text);
  }
  .header-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .header-btn.close {
    font-size: 20px;
  }

  .spinner-small {
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

  .group-tabs {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 18px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-bg-elevated);
  }
  .group-tabs button {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-muted);
    font-size: 12px;
    cursor: pointer;
  }
  .group-tabs button:hover {
    color: var(--ui-text);
  }
  .group-tabs button.active {
    background: var(--ui-accent, #3b82f6);
    border-color: var(--ui-accent, #3b82f6);
    color: var(--ui-text-on-accent, #fff);
  }
  .group-tabs .expand-all {
    margin-left: auto;
  }

  .drawer-body {
    flex: 1 1 0;
    min-height: 0;
    height: 0;
    overflow-y: auto;
    padding: 12px 14px;
  }
  .drawer-body > * + * {
    margin-top: 10px;
  }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    color: var(--ui-text-muted);
  }
  .empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }
  .empty-title {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 600;
    color: var(--ui-text);
  }
  .empty-desc {
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.6;
  }
  .empty-action {
    padding: 6px 14px;
    background: var(--ui-accent, #3b82f6);
    border: 1px solid var(--ui-accent, #3b82f6);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-on-accent, #fff);
    font-size: 13px;
    cursor: pointer;
  }

  .drawer-fade-enter-active,
  .drawer-fade-leave-active {
    transition: opacity 0.2s;
  }
  .drawer-fade-enter-from,
  .drawer-fade-leave-to {
    opacity: 0;
  }
  .drawer-fade-enter-active .drawer-panel,
  .drawer-fade-leave-active .drawer-panel {
    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .drawer-fade-enter-from .drawer-panel,
  .drawer-fade-leave-to .drawer-panel {
    transform: translateX(100%);
  }
</style>

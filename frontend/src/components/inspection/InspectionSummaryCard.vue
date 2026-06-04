<!--
  @file InspectionSummaryCard.vue
  @description 自检结果摘要卡片（顶部）

  展示:
  - 状态图标（✓ 全部通过 / ⚠️ 有问题）
  - 问题数 + 严重度分布
  - 上次自检时间
  - 操作按钮：重新检查 / 全部展开 / 复制全部
-->
<template>
  <div class="summary-card" :class="severityClass">
    <div class="summary-status">
      <span class="status-icon">{{ statusIcon }}</span>
      <div class="status-text">
        <div class="status-title">
          {{ statusTitle }}
        </div>
        <div class="status-subtitle">
          <span v-if="lastCheckedAt" class="check-time">
            {{ t('inspection.summary.lastCheck', { time: formatTime(lastCheckedAt) }) }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="unresolvedCount > 0" class="severity-stats">
      <span v-if="counts.blocker > 0" class="stat stat-blocker">
        🔴 {{ counts.blocker }} {{ t('inspection.severity.blocker') }}
      </span>
      <span v-if="counts.warning > 0" class="stat stat-warning">
        ⚠️ {{ counts.warning }} {{ t('inspection.severity.warning') }}
      </span>
      <span v-if="counts.info > 0" class="stat stat-info">
        ℹ️ {{ counts.info }} {{ t('inspection.severity.info') }}
      </span>
    </div>

    <div v-else class="all-clear">
      <span class="check-icon">🎉</span>
      <span>{{ t('inspection.summary.allClear') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'

  const props = defineProps<{
    unresolvedCount: number
    totalCount: number
    ignoredCount: number
    lastCheckedAt: string | null
    isPass: boolean
    blockerCount: number
    warningCount: number
    infoCount: number
  }>()

  const { t } = useI18n()

  defineEmits<{
    recheck: []
    expandAll: []
    copyAll: []
  }>()

  const counts = computed(() => ({
    blocker: props.blockerCount,
    warning: props.warningCount,
    info: props.infoCount,
  }))

  const severityClass = computed(() => {
    if (props.isPass) return 'is-pass'
    if (props.unresolvedCount > 0) return 'is-warning'
    return 'is-pass'
  })

  const statusIcon = computed(() => (props.isPass ? '✅' : '⚠️'))
  const statusTitle = computed(() =>
    props.isPass
      ? t('inspection.summary.passedTitle')
      : t('inspection.summary.issuesTitle', { count: props.unresolvedCount })
  )

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso)
      return d.toLocaleTimeString()
    } catch {
      return iso
    }
  }
</script>

<style scoped>
  .summary-card {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 18px;
    background: var(--ui-bg-elevated);
    border-bottom: 1px solid var(--ui-border);
  }

  .is-pass {
    background: linear-gradient(
      90deg,
      rgba(34, 197, 94, 0.06) 0%,
      var(--ui-bg-elevated) 60%
    );
  }
  .is-warning {
    background: linear-gradient(
      90deg,
      rgba(245, 158, 11, 0.08) 0%,
      var(--ui-bg-elevated) 60%
    );
  }

  .summary-status {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .status-icon {
    font-size: 24px;
    line-height: 1;
  }

  .status-text {
    flex: 1;
    min-width: 0;
  }

  .status-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--ui-text);
    line-height: 1.3;
  }

  .status-subtitle {
    margin-top: 2px;
    font-size: 12px;
    color: var(--ui-text-muted);
  }

  .check-time {
    font-family: monospace;
  }

  .severity-stats {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 500;
  }
  .stat-blocker {
    background: var(--ui-danger-subtle, rgba(239, 68, 68, 0.12));
    color: var(--ui-danger, #ef4444);
  }
  .stat-warning {
    background: var(--ui-warning-subtle, rgba(245, 158, 11, 0.12));
    color: var(--ui-warning, #f59e0b);
  }
  .stat-info {
    background: var(--ui-info-subtle, rgba(59, 130, 246, 0.12));
    color: var(--ui-info, #3b82f6);
  }

  .all-clear {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--ui-success, #22c55e);
  }

  .check-icon {
    font-size: 18px;
  }
</style>

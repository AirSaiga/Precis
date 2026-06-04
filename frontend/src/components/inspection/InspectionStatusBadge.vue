<!--
  @file InspectionStatusBadge.vue
  @description 状态栏徽章 — Header 右上角常驻

  行为:
  - 无问题且无忽略时完全隐藏
  - 有未解决问题：显示数字徽章（最严重级别颜色）
  - 全部已忽略但 inspection result 仍有问题：显示静默徽章（🔕 + 忽略数），保留打开抽屉的入口
  - 点击打开 InspectionDrawer
  - hover 提示：列出最高严重度 + 数量 / 已忽略数
-->
<template>
  <button
    v-if="hasContent"
    class="inspection-badge"
    :class="badgeClass"
    :title="tooltipText"
    @click="store.openDrawer()"
  >
    <span class="badge-icon">{{ badgeIcon }}</span>
    <span class="badge-count">{{ badgeCount }}</span>
  </button>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useInspectionStore } from '@/stores/inspectionStore'

  const store = useInspectionStore()
  const { t } = useI18n()

  const SEVERITY_ICONS: Record<string, string> = {
    blocker: '🔴',
    warning: '⚠️',
    info: 'ℹ️',
  }

  // 全部已忽略：当前 inspection 有问题，但都被忽略了
  const isIgnoredOnly = computed(
    () => store.unresolvedCount === 0 && store.allIssues.length > 0
  )

  const hasContent = computed(() => store.unresolvedCount > 0 || isIgnoredOnly.value)

  const badgeClass = computed(() => {
    if (isIgnoredOnly.value) return 'severity-muted'
    return `severity-${store.maxSeverity ?? 'warning'}`
  })

  const badgeIcon = computed(() => {
    if (isIgnoredOnly.value) return '🔕'
    return SEVERITY_ICONS[store.maxSeverity ?? 'warning'] ?? '⚠️'
  })

  const badgeCount = computed(() =>
    isIgnoredOnly.value ? store.allIssues.length : store.unresolvedCount
  )

  const tooltipText = computed(() => {
    if (isIgnoredOnly.value) {
      return t('inspection.badge.ignoredTooltip', { count: store.allIssues.length })
    }
    const maxLabel = store.maxSeverity ? t(`inspection.severity.${store.maxSeverity}`) : ''
    return `${t('inspection.badge.tooltip', { count: store.unresolvedCount })} · ${maxLabel}`
  })
</script>

<style scoped>
  .inspection-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px;
    background: var(--ui-bg-elevated);
    border: 1px solid var(--ui-border);
    border-radius: 14px;
    color: var(--ui-text);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .inspection-badge:hover {
    transform: translateY(-1px);
    box-shadow: var(--ui-shadow-sm);
  }

  .severity-blocker {
    background: var(--ui-danger-subtle, rgba(239, 68, 68, 0.12));
    color: var(--ui-danger, #ef4444);
    border-color: transparent;
  }
  .severity-blocker:hover {
    background: var(--ui-danger, #ef4444);
    color: var(--ui-text-on-accent, #fff);
  }

  .severity-warning {
    background: var(--ui-warning-subtle, rgba(245, 158, 11, 0.12));
    color: var(--ui-warning, #f59e0b);
    border-color: transparent;
  }
  .severity-warning:hover {
    background: var(--ui-warning, #f59e0b);
    color: var(--ui-text-on-accent, #fff);
  }

  .severity-info {
    background: var(--ui-info-subtle, rgba(59, 130, 246, 0.12));
    color: var(--ui-info, #3b82f6);
    border-color: transparent;
  }
  .severity-info:hover {
    background: var(--ui-info, #3b82f6);
    color: var(--ui-text-on-accent, #fff);
  }

  .severity-muted {
    background: var(--ui-bg-elevated);
    color: var(--ui-text-muted);
    border-color: var(--ui-border);
  }
  .severity-muted:hover {
    background: var(--ui-bg-panel);
    color: var(--ui-text);
  }

  .badge-icon {
    font-size: 12px;
    line-height: 1;
  }
  .badge-count {
    font-variant-numeric: tabular-nums;
  }
</style>

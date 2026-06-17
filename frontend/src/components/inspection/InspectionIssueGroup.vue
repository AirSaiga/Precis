<!--
  @file InspectionIssueGroup.vue
  @description 按文件/严重度分组的折叠组

  分组策略:
  - file:     每个 issue.file_path 一组（默认）
  - severity: 按 issue.severity 分三组（blocker / warning / info）

  头部: 文件名 + 该组问题数 + 折叠/展开
-->
<template>
  <section class="issue-group" :class="`group-${group.severity}`">
    <header class="group-header" @click="expanded = !expanded">
      <span class="caret" :class="{ expanded }">▸</span>
      <span class="group-icon">{{ icon }}</span>
      <span class="group-title" :title="group.title">{{ group.title }}</span>
      <span class="group-count">{{ group.issues.length }}</span>
      <button
        v-if="group.issues.length > 0"
        class="dismiss-all"
        :title="t('inspection.action.dismissAllInGroup')"
        @click.stop="dismissAllInGroup"
      >
        {{ t('inspection.action.dismissAllShort') }}
      </button>
    </header>

    <Transition name="expand">
      <div v-if="expanded" class="group-issues">
        <InspectionIssueCard
          v-for="issue in group.issues"
          :key="issue.id"
          :issue="issue"
          :ignored="ignoredIds.has(issue.id)"
          :fixing="fixingIds.has(issue.id)"
          @dismiss="$emit('dismiss', $event)"
          @restore="$emit('restore', $event)"
          @action="(i, a) => $emit('action', i, a)"
          @select-fix-table="(i, newId) => $emit('selectFixTable', i, newId)"
          @select-fix-column="(i, newId) => $emit('selectFixColumn', i, newId)"
        />
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import InspectionIssueCard from './InspectionIssueCard.vue'
  import type { InspectionIssue } from '@/types/projectV2'

  export interface IssueGroup {
    key: string
    title: string
    severity: 'blocker' | 'warning' | 'info'
    issues: InspectionIssue[]
  }

  const props = defineProps<{
    group: IssueGroup
    ignoredIds: Set<string>
    fixingIds: Set<string>
    /** 是否默认展开（severity=blocker 时为 true） */
    defaultExpanded?: boolean
  }>()

  const emit = defineEmits<{
    dismiss: [issueId: string]
    restore: [issueId: string]
    dismissGroup: [issueIds: string[]]
    action: [issue: InspectionIssue, action: any]
    /** 用户从可用表列表选择一个表来修正引用（转发给 Drawer 走 auto_fix） */
    selectFixTable: [issue: InspectionIssue, newTableId: string]
    /** 用户从可用列列表选择一个列来修正引用（转发给 Drawer 走 auto_fix） */
    selectFixColumn: [issue: InspectionIssue, newColumnId: string]
  }>()

  const { t } = useI18n()
  const expanded = ref(props.defaultExpanded ?? props.group.severity === 'blocker')

  watch(
    () => props.defaultExpanded,
    (val) => {
      if (val !== undefined) expanded.value = val
    }
  )

  const icon = computed(() => {
    if (props.group.key.startsWith('file-')) return '📄'
    return '🪧'
  })

  function dismissAllInGroup(): void {
    emit(
      'dismissGroup',
      props.group.issues.map((i) => i.id)
    )
  }
</script>

<style scoped>
  .issue-group {
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    background: var(--ui-bg-elevated);
    overflow: hidden;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    cursor: pointer;
    user-select: none;
    background: var(--ui-bg-panel);
    border-bottom: 1px solid var(--ui-border);
    transition: background 0.15s;
  }
  .group-header:hover {
    background: var(--ui-bg-base);
  }

  .group-blocker .group-header {
    background: linear-gradient(
      90deg,
      var(--ui-danger-subtle, rgba(239, 68, 68, 0.08)) 0%,
      var(--ui-bg-panel) 100%
    );
  }
  .group-warning .group-header {
    background: linear-gradient(
      90deg,
      var(--ui-warning-subtle, rgba(245, 158, 11, 0.08)) 0%,
      var(--ui-bg-panel) 100%
    );
  }

  .caret {
    font-size: 10px;
    color: var(--ui-text-muted);
    transition: transform 0.15s;
    display: inline-block;
    width: 10px;
  }
  .caret.expanded {
    transform: rotate(90deg);
  }

  .group-icon {
    font-size: 14px;
  }

  .group-title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--ui-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .group-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 20px;
    padding: 0 6px;
    background: var(--ui-bg-base);
    border: 1px solid var(--ui-border);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--ui-text-muted);
  }
  .group-blocker .group-count {
    background: var(--ui-danger-subtle, rgba(239, 68, 68, 0.12));
    color: var(--ui-danger, #ef4444);
    border-color: transparent;
  }
  .group-warning .group-count {
    background: var(--ui-warning-subtle, rgba(245, 158, 11, 0.12));
    color: var(--ui-warning, #f59e0b);
    border-color: transparent;
  }

  .dismiss-all {
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-muted);
    font-size: 11px;
    cursor: pointer;
  }
  .dismiss-all:hover {
    border-color: var(--ui-text-muted);
    color: var(--ui-text);
  }

  .group-issues {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
  }

  .expand-enter-active,
  .expand-leave-active {
    transition: all 0.2s;
    overflow: hidden;
  }
  .expand-enter-from,
  .expand-leave-to {
    opacity: 0;
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
  }
  .expand-enter-to,
  .expand-leave-from {
    opacity: 1;
    max-height: 4000px;
  }
</style>

<!--
  @file InspectionIgnoredManager.vue
  @description 管理已忽略的 issue 列表

  用户可在此查看/恢复所有被忽略的问题。提供"全部恢复"快捷按钮。
-->
<template>
  <div v-if="visible" class="iim-overlay" @click.self="close">
    <div class="iim-modal">
      <header class="iim-header">
        <h3>{{ t('inspection.ignoredManager.title') }}</h3>
        <button class="iim-close" @click="close"><X :size="18" /></button>
      </header>

      <div class="iim-body">
        <div v-if="store.ignoredIds.size === 0" class="iim-empty">
          <div class="iim-empty-icon"><AppIcon name="inbox" :size="36" /></div>
          <p>{{ t('inspection.ignoredManager.empty') }}</p>
        </div>

        <ul v-else class="iim-list">
          <li v-for="issueId in [...store.ignoredIds]" :key="issueId" class="iim-item">
            <span class="iim-item-title">{{ issueTitleMap[issueId] ?? issueId }}</span>
            <button class="iim-restore" @click="restore(issueId)">
              {{ t('inspection.action.restore') }}
            </button>
          </li>
        </ul>
      </div>

      <footer class="iim-footer">
        <button v-if="store.ignoredIds.size > 0" class="iim-clear-all" @click="clearAll">
          {{ t('inspection.ignoredManager.clearAll') }}
        </button>
        <button class="iim-confirm" @click="close">
          {{ t('common.confirm') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { X } from '@lucide/vue'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import { useInspectionStore } from '@/stores/inspectionStore'
  import type { InspectionIssue } from '@/types/projectV2'

  const props = defineProps<{
    visible: boolean
    allIssues: InspectionIssue[]
  }>()
  const emit = defineEmits<{ close: [] }>()

  const { t } = useI18n()
  const store = useInspectionStore()

  const issueTitleMap = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const issue of props.allIssues) {
      map[issue.id] = issue.title
    }
    return map
  })

  function close(): void {
    emit('close')
  }

  function restore(id: string): void {
    store.restore(id)
  }

  function clearAll(): void {
    store.clearAllIgnored()
  }
</script>

<style scoped>
  .iim-overlay {
    position: fixed;
    inset: 0;
    background: var(--ui-overlay-backdrop-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 30000;
    backdrop-filter: blur(4px);
  }

  .iim-modal {
    background: var(--ui-bg-elevated);
    width: 480px;
    max-width: 90vw;
    max-height: 70vh;
    border-radius: var(--ui-radius-lg);
    box-shadow: var(--ui-shadow-lg);
    border: 1px solid var(--ui-border);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .iim-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 20px;
    border-bottom: 1px solid var(--ui-border);
  }
  .iim-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--ui-text);
  }

  .iim-close {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--ui-text-subtle);
    cursor: pointer;
    line-height: 1;
  }
  .iim-close:hover {
    color: var(--ui-text);
  }

  .iim-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 20px;
  }

  .iim-empty {
    text-align: center;
    padding: 40px 0;
    color: var(--ui-text-muted);
  }
  .iim-empty-icon {
    font-size: 36px;
    margin-bottom: 8px;
  }

  .iim-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .iim-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--ui-bg-panel);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
  }

  .iim-item-title {
    flex: 1;
    font-size: 13px;
    color: var(--ui-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .iim-restore {
    padding: 2px 8px;
    background: var(--ui-info-subtle, rgba(59, 130, 246, 0.12));
    border: 1px solid transparent;
    border-radius: var(--ui-radius-sm);
    color: var(--ui-info, #3b82f6);
    font-size: 12px;
    cursor: pointer;
  }
  .iim-restore:hover {
    background: var(--ui-info, #3b82f6);
    color: var(--ui-text-on-accent, #fff);
  }

  .iim-footer {
    display: flex;
    justify-content: space-between;
    padding: 12px 20px;
    border-top: 1px solid var(--ui-border);
    background: var(--ui-bg-panel);
  }

  .iim-clear-all {
    padding: 6px 14px;
    background: transparent;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-muted);
    font-size: 13px;
    cursor: pointer;
  }
  .iim-clear-all:hover {
    color: var(--ui-danger, #ef4444);
    border-color: var(--ui-danger, #ef4444);
  }

  .iim-confirm {
    padding: 6px 16px;
    background: var(--ui-accent, #3b82f6);
    border: 1px solid var(--ui-accent, #3b82f6);
    border-radius: var(--ui-radius-sm);
    color: var(--ui-text-on-accent, #fff);
    font-size: 13px;
    cursor: pointer;
  }
</style>

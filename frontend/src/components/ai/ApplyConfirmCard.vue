<!--
  @file ApplyConfirmCard.vue
  @description apply_actions 改动确认卡

  形态参照 ToolTrailCard（折叠卡），展示：
  - 折叠态：单行 "📝 将修改 N 个文件 · 等待确认"
  - 展开态：文件列表 + unified diff + 确认/拒绝按钮

  Props:
    - apply: PendingApply 挂起的改动数据
    - onDecide: (decision: 'confirm' | 'reject') => Promise<void>
-->
<template>
  <div v-if="apply" class="apply-confirm-card">
    <button class="confirm-header" type="button" @click="toggle">
      <span class="confirm-icon">📝</span>
      <span class="confirm-summary">{{ summaryText }}</span>
      <span class="confirm-toggle" :class="{ expanded: isExpanded }">▾</span>
    </button>
    <div v-if="isExpanded" class="confirm-body">
      <div v-if="fileList.length === 0" class="confirm-empty">
        {{ t('aiChat.confirmNoFiles') }}
      </div>
      <div v-for="file in fileList" :key="file.path" class="confirm-file">
        <div class="file-header">
          <span class="file-status" :class="file.status">{{ statusLabel(file.status) }}</span>
          <span class="file-path">{{ file.path }}</span>
        </div>
        <pre v-if="file.diff" class="file-diff"><code>{{ file.diff }}</code></pre>
      </div>
      <div class="confirm-actions">
        <button class="btn-reject" :disabled="deciding" @click="handleDecide('reject')">
          {{ t('aiChat.confirmReject') }}
        </button>
        <button class="btn-confirm" :disabled="deciding" @click="handleDecide('confirm')">
          {{ deciding ? t('aiChat.confirmDeciding') : t('aiChat.confirmApply') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { PendingApply, PendingFileDiff } from '@/composables/shared/useStreamingMessage'

  interface Props {
    apply: PendingApply | null
    onDecide: (decision: 'confirm' | 'reject') => Promise<void>
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  const isExpanded = ref(false) // 默认折叠，避免 diff 占用过多空间
  const deciding = ref(false)

  function toggle() {
    isExpanded.value = !isExpanded.value
  }

  const fileList = computed<PendingFileDiff[]>(() => {
    return props.apply?.files ?? []
  })

  const summaryText = computed(() => {
    if (!props.apply) return ''
    const total = Object.values(props.apply.summary).reduce((a, b) => a + b, 0)
    return t('aiChat.confirmPending', { total })
  })

  function statusLabel(status: string): string {
    if (status === 'created') return t('aiChat.confirmCreated')
    if (status === 'deleted') return t('aiChat.confirmDeleted')
    return t('aiChat.confirmModified')
  }

  async function handleDecide(decision: 'confirm' | 'reject') {
    if (deciding.value) return
    deciding.value = true
    try {
      await props.onDecide(decision)
    } finally {
      deciding.value = false
    }
  }
</script>

<style scoped>
  .confirm-card {
    margin: var(--ui-space-sm) 0;
    border: 1px solid var(--ui-border-warning);
    border-radius: var(--ui-radius-sm);
    overflow: hidden;
    font-size: var(--ui-font-size-sm);
    background: var(--ui-bg-warning);
  }
  .confirm-header {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    width: 100%;
    padding: var(--ui-space-sm) 10px;
    background: transparent;
    border: none;
    color: var(--ui-warning-text);
    cursor: pointer;
    text-align: left;
  }
  .confirm-icon {
    font-size: var(--ui-font-size-md);
  }
  .confirm-summary {
    flex: 1;
  }
  .confirm-toggle {
    transition: transform 0.15s;
  }
  .confirm-toggle.expanded {
    transform: rotate(180deg);
  }
  .confirm-body {
    padding: var(--ui-space-sm) 10px;
    border-top: 1px solid var(--ui-border-warning);
  }
  .confirm-empty {
    color: var(--ui-text-secondary);
    padding: var(--ui-space-xs) 0;
  }
  .confirm-file {
    margin-bottom: var(--ui-space-sm);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    overflow: hidden;
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    padding: var(--ui-space-xs) var(--ui-space-sm);
    background: var(--ui-bg-muted);
  }
  .file-status {
    font-weight: bold;
    font-size: var(--ui-font-size-xs);
    text-transform: uppercase;
    padding: 1px var(--ui-space-xs);
    border-radius: var(--ui-radius-sm);
  }
  .file-status.created {
    color: var(--ui-success);
    background: var(--ui-success-bg);
  }
  .file-status.deleted {
    color: var(--ui-danger);
    background: var(--ui-danger-bg);
  }
  .file-status.modified {
    color: var(--ui-warning-text);
    background: var(--ui-warning-bg);
  }
  .file-path {
    color: var(--ui-text-primary);
    font-family: var(--ui-font-mono);
    font-size: var(--ui-font-size-xs);
  }
  .file-diff {
    margin: 0;
    padding: var(--ui-space-xs) var(--ui-space-sm);
    max-height: 240px;
    overflow: auto;
    background: var(--ui-bg-base);
    font-size: var(--ui-font-size-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    color: var(--ui-text-secondary);
    font-family: var(--ui-font-mono);
  }
  /* diff 行级着色 */
  .file-diff :deep(.diff-add) {
    color: var(--ui-success);
  }
  .file-diff :deep(.diff-del) {
    color: var(--ui-danger);
  }
  .confirm-actions {
    display: flex;
    gap: var(--ui-space-sm);
    justify-content: flex-end;
    margin-top: var(--ui-space-sm);
    padding-top: var(--ui-space-sm);
    border-top: 1px solid var(--ui-border);
  }
  .btn-reject,
  .btn-confirm {
    padding: var(--ui-space-xs) 12px;
    border-radius: var(--ui-radius-sm);
    border: 1px solid;
    font-size: var(--ui-font-size-sm);
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn-reject {
    background: transparent;
    color: var(--ui-danger);
    border-color: var(--ui-danger-weak);
  }
  .btn-reject:hover:not(:disabled) {
    background: var(--ui-danger-bg);
  }
  .btn-confirm {
    background: var(--ui-accent);
    color: var(--ui-text-on-accent);
    border-color: var(--ui-accent);
    font-weight: var(--ui-font-weight-semibold);
  }
  .btn-confirm:hover:not(:disabled) {
    background: var(--ui-accent-hover);
  }
  .btn-reject:disabled,
  .btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

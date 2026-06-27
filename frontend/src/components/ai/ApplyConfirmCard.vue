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

  const isExpanded = ref(true)
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
  .apply-confirm-card {
    margin: 4px 0;
    border: 1px solid #f59e0b;
    border-radius: 6px;
    overflow: hidden;
    font-size: 12px;
    background: rgba(245, 158, 11, 0.05);
  }
  .confirm-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: transparent;
    border: none;
    color: #f59e0b;
    cursor: pointer;
    text-align: left;
  }
  .confirm-icon {
    font-size: 14px;
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
    padding: 8px 10px;
    border-top: 1px solid rgba(245, 158, 11, 0.2);
  }
  .confirm-empty {
    color: var(--text-secondary, #9ca3af);
    padding: 4px 0;
  }
  .confirm-file {
    margin-bottom: 8px;
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    overflow: hidden;
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: rgba(0, 0, 0, 0.15);
  }
  .file-status {
    font-weight: bold;
    font-size: 10px;
    text-transform: uppercase;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .file-status.created {
    color: #34d399;
    background: rgba(52, 211, 153, 0.15);
  }
  .file-status.deleted {
    color: #f87171;
    background: rgba(248, 113, 113, 0.15);
  }
  .file-status.modified {
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.15);
  }
  .file-path {
    color: var(--text-primary, #e0e0e0);
    font-family: monospace;
    font-size: 11px;
  }
  .file-diff {
    margin: 0;
    padding: 4px 8px;
    max-height: 200px;
    overflow: auto;
    background: rgba(0, 0, 0, 0.2);
    font-size: 10px;
    line-height: 1.4;
    white-space: pre-wrap;
    color: var(--text-secondary, #9ca3af);
  }
  .file-diff code {
    font-family: 'Cascadia Code', 'Fira Code', monospace;
  }
  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-color, #333);
  }
  .btn-reject,
  .btn-confirm {
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid;
    font-size: 12px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn-reject {
    background: transparent;
    color: #f87171;
    border-color: #f87171;
  }
  .btn-reject:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.1);
  }
  .btn-confirm {
    background: #f59e0b;
    color: #000;
    border-color: #f59e0b;
    font-weight: bold;
  }
  .btn-confirm:hover:not(:disabled) {
    background: #fbbf24;
  }
  .btn-reject:disabled,
  .btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

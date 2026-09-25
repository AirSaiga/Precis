<!--
SPDX-License-Identifier: Apache-2.0

Copyright 2026 Precis Team

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<!--
  @file CanvasSyncCard.vue
  @description 画布对账摘要卡（v2 变更集同步结果状态行）

  AI 消息的全部变更集信封经对账队列排空后渲染：
  - 全部成功：单行"画布已同步：新增 N、更新 N、移除 N"
  - 部分失败：摘要行标红 + 失败实体清单 + "配置已写盘，建议重新加载项目"提示
-->
<template>
  <div class="canvas-sync-card" :class="{ 'has-failed': summary.failed.length > 0 }">
    <div class="sync-line">
      <span class="sync-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <polyline points="21 3 21 9 15 9" />
        </svg>
      </span>
      <span class="sync-text">{{ summaryText }}</span>
    </div>
    <div v-if="summary.failed.length > 0" class="sync-failures">
      <div v-for="(f, idx) in summary.failed" :key="idx" class="sync-failure-item">
        <span class="failure-entity">{{ f.entityId }}</span>
        <span class="failure-error">{{ f.error }}</span>
      </div>
      <div class="sync-failure-hint">{{ t('aiChat.canvasSyncFailedMessage') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { CanvasSyncSummary } from '@/composables/shared/useStreamingMessage'

  interface Props {
    summary: CanvasSyncSummary
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  const summaryText = computed(() => {
    const counts = {
      added: props.summary.added,
      updated: props.summary.updated,
      removed: props.summary.removed,
    }
    if (props.summary.failed.length > 0) {
      return t('aiChat.canvasSyncPartial', { ...counts, failed: props.summary.failed.length })
    }
    return t('aiChat.canvasSyncDone', counts)
  })
</script>

<style scoped>
  .canvas-sync-card {
    margin: var(--ui-space-xs) 0;
    padding: var(--ui-space-xs) 10px;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    font-size: var(--ui-font-size-xs);
    color: var(--ui-text-secondary);
  }
  .canvas-sync-card.has-failed {
    border-left: 3px solid var(--ui-danger);
    color: var(--ui-text-primary);
  }
  .sync-line {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sync-icon {
    display: flex;
    align-items: center;
    color: var(--ui-success);
  }
  .has-failed .sync-icon {
    color: var(--ui-danger);
  }
  .sync-failures {
    margin-top: var(--ui-space-xs);
    padding-top: var(--ui-space-xs);
    border-top: 1px dashed var(--ui-border-light);
  }
  .sync-failure-item {
    display: flex;
    gap: var(--ui-space-sm);
    margin: 2px 0;
  }
  .failure-entity {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--ui-danger);
  }
  .failure-error {
    overflow-wrap: anywhere;
  }
  .sync-failure-hint {
    margin-top: var(--ui-space-xs);
    color: var(--ui-danger);
    font-style: italic;
  }
</style>

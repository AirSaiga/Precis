<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  interface PreflightRef {
    id: string
    path: string
  }

  defineProps<{
    issueCount: number
    missingConstraints: PreflightRef[]
    missingRegexes: PreflightRef[]
    danglingConstraints: PreflightRef[]
    danglingRegexes: PreflightRef[]
  }>()

  const emit = defineEmits<{
    (e: 'refresh'): void
  }>()

  const { t } = useI18n()
</script>

<template>
  <div v-if="issueCount > 0" class="preflight-box">
    <div class="preflight-main">
      <div class="preflight-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div class="preflight-info">
        <span class="preflight-text">
          {{ t('common.fullValidation.task.preflight.attention', { count: issueCount }) }}
        </span>
        <div class="preflight-stats">
          <span>{{ t('common.fullValidation.task.preflight.unlistedResources') }}: {{ missingConstraints.length + missingRegexes.length }}</span>
          <span class="preflight-stat-sep">·</span>
          <span>{{ t('common.fullValidation.task.preflight.danglingResources') }}: {{ danglingConstraints.length + danglingRegexes.length }}</span>
        </div>
      </div>
      <button class="preflight-refresh" type="button" @click="emit('refresh')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <polyline points="23 20 23 14 17 14" />
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
        </svg>
      </button>
    </div>
    <div class="preflight-tags">
      <span
        v-for="item in [...missingConstraints, ...missingRegexes, ...danglingConstraints, ...danglingRegexes].slice(0, 5)"
        :key="item.id"
        class="preflight-tag"
      >
        {{ item.id }}
      </span>
      <span
        v-if="missingConstraints.length + missingRegexes.length + danglingConstraints.length + danglingRegexes.length > 5"
        class="preflight-tag preflight-tag--more"
      >
        +{{ missingConstraints.length + missingRegexes.length + danglingConstraints.length + danglingRegexes.length - 5 }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.preflight-box {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-sm);
  padding: var(--ui-space-md) var(--ui-space-lg);
  background: var(--ui-bg-panel);
  border: 1px solid color-mix(in srgb, var(--ui-warning-strong) 15%, transparent);
  border-left: 3px solid var(--ui-warning-strong);
  border-radius: var(--ui-radius-md);
}

.preflight-main {
  display: flex;
  align-items: flex-start;
  gap: var(--ui-space-sm);
}

.preflight-icon {
  flex-shrink: 0;
  color: var(--ui-warning-strong);
  margin-top: 1px;
}

.preflight-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preflight-text {
  font-size: var(--ui-font-size-sm);
  font-weight: var(--ui-font-weight-medium);
  color: var(--ui-warning-strong);
}

.preflight-stats {
  display: flex;
  align-items: center;
  gap: var(--ui-space-xs);
  font-size: var(--ui-font-size-xs);
  color: var(--ui-text-muted);
}

.preflight-stat-sep {
  opacity: 0.4;
}

.preflight-refresh {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--ui-border-light);
  border-radius: var(--ui-radius-md);
  background: var(--ui-bg-panel);
  color: var(--ui-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.preflight-refresh:hover {
  background: var(--ui-bg-subtle);
  color: var(--ui-text-body);
  border-color: var(--ui-border);
}

.preflight-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ui-space-xs);
  padding-left: calc(16px + var(--ui-space-sm));
}

.preflight-tag {
  padding: 2px 8px;
  border-radius: var(--ui-radius-full);
  background: color-mix(in srgb, var(--ui-warning-strong) 10%, var(--ui-bg-subtle));
  color: var(--ui-warning-strong);
  font-size: var(--ui-font-size-xs);
  font-weight: var(--ui-font-weight-medium);
}

.preflight-tag--more {
  background: var(--ui-bg-subtle);
  color: var(--ui-text-muted);
}
</style>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  defineProps<{
    targetLabel: string
    configPath: string
    preflightStatus: string
    preflightTone: 'success' | 'warning' | 'danger'
  }>()

  const { t } = useI18n()
</script>

<template>
  <div class="context-summary" :class="`is-${preflightTone}`">
    <span class="context-item">{{ targetLabel }}</span>
    <span class="context-separator">·</span>
    <span class="context-item context-item--path" :title="configPath">{{ configPath || '-' }}</span>
    <span class="context-separator">·</span>
    <span class="context-item context-item--status">
      <svg
        v-if="preflightTone === 'success'"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <svg
        v-else-if="preflightTone === 'warning'"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
      </svg>
      <svg
        v-else
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
      </svg>
      {{ preflightStatus }}
    </span>
  </div>
</template>

<style scoped>
.context-summary {
  display: flex;
  align-items: center;
  gap: var(--ui-space-sm);
  padding: var(--ui-space-sm) 0;
  font-size: var(--ui-font-size-sm);
  color: var(--ui-text-muted);
  flex-wrap: wrap;
}

.context-separator {
  opacity: 0.4;
  user-select: none;
}

.context-item--path {
  font-family: var(--ui-font-mono);
  font-size: var(--ui-font-size-xs);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-item--status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: var(--ui-font-weight-medium);
}

.context-summary.is-success .context-item--status {
  color: var(--ui-success-strong);
}

.context-summary.is-warning .context-item--status {
  color: var(--ui-warning-strong);
}

.context-summary.is-danger .context-item--status {
  color: var(--ui-danger-strong);
}

@media (max-width: 640px) {
  .context-item--path {
    max-width: 200px;
  }
}
</style>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  defineProps<{
    filesLoaded: number
    filesTotal: number
    tablesLoaded: number
    tablesTotal: number
    errorsFound: number
    durationMs: number
  }>()

  const { t } = useI18n()
</script>

<template>
  <div class="fv-stats-mini">
    <div class="fv-stats-mini-item">
      <div class="fv-stats-mini-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>
      <div class="fv-stats-mini-content">
        <span class="fv-stats-mini-value">{{ filesLoaded }}/{{ filesTotal }}</span>
        <span class="fv-stats-mini-label">{{ t('validation.stats.files') }}</span>
      </div>
    </div>
    <div class="fv-stats-mini-item">
      <div class="fv-stats-mini-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
      </div>
      <div class="fv-stats-mini-content">
        <span class="fv-stats-mini-value">{{ tablesLoaded }}/{{ tablesTotal }}</span>
        <span class="fv-stats-mini-label">{{ t('validation.stats.tables') }}</span>
      </div>
    </div>
    <div class="fv-stats-mini-item" :class="{ 'is-error': errorsFound > 0 }">
      <div class="fv-stats-mini-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div class="fv-stats-mini-content">
        <span class="fv-stats-mini-value">{{ errorsFound }}</span>
        <span class="fv-stats-mini-label">{{ t('validation.stats.errors') }}</span>
      </div>
    </div>
    <div class="fv-stats-mini-item">
      <div class="fv-stats-mini-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <div class="fv-stats-mini-content">
        <span class="fv-stats-mini-value">{{ durationMs }}ms</span>
        <span class="fv-stats-mini-label">{{ t('validation.stats.duration') }}</span>
      </div>
    </div>
  </div>
</template>

<!--
  @file ValidationSummaryRenderer.vue
  @description 校验摘要渲染器，显示通过率和错误数（从 store 读取）
-->
<template>
  <div class="field validation-summary-field">
    <div class="validation-summary">
      <div class="summary-card" :class="passRateClass">
        <div class="summary-card__icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        </div>
        <div class="summary-card__content">
          <label>{{ t('inspector.projectRoot.validation.passRate') }}</label>
          <div class="summary-card__value">{{ passRateText }}</div>
        </div>
      </div>

      <div class="summary-card" :class="{ 'has-errors': errorCount > 0 }">
        <div class="summary-card__icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            ></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </div>
        <div class="summary-card__content">
          <label>{{ t('inspector.projectRoot.validation.errorCount') }}</label>
          <div class="summary-card__value">{{ errorCount }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useGraphStore } from '@/stores/graphStore'
  import type { InspectorContext } from '../utils'
  import type { InspectorValidationSummaryField } from '../types'

  const { t } = useI18n()
  const graphStore = useGraphStore()

  defineProps<{
    field: InspectorValidationSummaryField
    ctx: InspectorContext
    value: unknown
    label: string
    help?: string
    placeholder?: string
    readonly: boolean
  }>()

  const validationStatistics = computed(() => graphStore.lastFullValidationStatistics)
  const validationSummary = computed(() => graphStore.lastFullValidationSummary)

  const passRate = computed(() => {
    const stats = validationStatistics.value
    if (!stats || !Number.isFinite(stats.pass_rate)) return null
    return stats.pass_rate
  })

  const errorCount = computed(() => validationSummary.value?.total_error_count ?? 0)

  const passRateText = computed(() => {
    if (passRate.value === null) return '-'
    return `${Math.round(passRate.value)}%`
  })

  const passRateClass = computed(() => {
    if (passRate.value === null) return 'no-data'
    if (passRate.value >= 100) return 'pass'
    if (passRate.value >= 60) return 'partial'
    return 'fail'
  })
</script>

<style scoped>
  .validation-summary-field {
    padding-top: 2px;
  }

  .validation-summary {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .summary-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    background: var(--ui-bg-subtle);
    border: 1px solid var(--ui-border-light);
    border-radius: var(--ui-radius-lg);
    transition:
      background var(--ui-transition-fast),
      border-color var(--ui-transition-fast);
  }

  .summary-card:hover {
    background: var(--ui-bg-muted);
    border-color: var(--ui-border);
  }

  .summary-card__icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--ui-radius-md);
    flex-shrink: 0;
    background: var(--ui-bg-elevated);
    color: var(--ui-text-muted);
  }

  .summary-card__content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .summary-card__content label {
    font-weight: 500;
    font-size: 11px;
    color: var(--ui-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .summary-card__value {
    font-size: 16px;
    font-weight: 600;
    color: var(--ui-text-strong);
  }

  /* 通过率状态色 */
  .summary-card.pass {
    background: color-mix(in srgb, var(--ui-success) 8%, var(--ui-bg-subtle));
    border-color: color-mix(in srgb, var(--ui-success) 20%, var(--ui-border-light));
  }

  .summary-card.pass .summary-card__icon {
    background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg-elevated));
    color: var(--ui-success);
  }

  .summary-card.partial {
    background: color-mix(in srgb, var(--ui-warning) 8%, var(--ui-bg-subtle));
    border-color: color-mix(in srgb, var(--ui-warning) 20%, var(--ui-border-light));
  }

  .summary-card.partial .summary-card__icon {
    background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg-elevated));
    color: var(--ui-warning);
  }

  .summary-card.fail {
    background: color-mix(in srgb, var(--ui-danger) 8%, var(--ui-bg-subtle));
    border-color: color-mix(in srgb, var(--ui-danger) 20%, var(--ui-border-light));
  }

  .summary-card.fail .summary-card__icon {
    background: color-mix(in srgb, var(--ui-danger) 12%, var(--ui-bg-elevated));
    color: var(--ui-danger);
  }

  .summary-card.no-data {
    background: var(--ui-bg-subtle);
    border-color: var(--ui-border-light);
  }

  /* 错误数状态色 */
  .summary-card.has-errors {
    background: color-mix(in srgb, var(--ui-danger) 8%, var(--ui-bg-subtle));
    border-color: color-mix(in srgb, var(--ui-danger) 20%, var(--ui-border-light));
  }

  .summary-card.has-errors .summary-card__icon {
    background: color-mix(in srgb, var(--ui-danger) 12%, var(--ui-bg-elevated));
    color: var(--ui-danger);
  }
</style>

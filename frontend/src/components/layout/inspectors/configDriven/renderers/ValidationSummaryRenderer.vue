<!--
  @file ValidationSummaryRenderer.vue
  @description 校验摘要渲染器，显示通过率和错误数（从 store 读取）
-->
<template>
  <div class="field validation-summary-field">
    <div class="validation-summary">
      <div class="summary-item">
        <label>{{ t('inspector.projectRoot.validation.passRate') }}</label>
        <div class="pass-rate-display" :class="passRateClass">
          {{ passRateText }}
        </div>
      </div>
      <div class="summary-item">
        <label>{{ t('inspector.projectRoot.validation.errorCount') }}</label>
        <div class="error-count-display" :class="{ 'has-errors': errorCount > 0 }">
          {{ errorCount }}
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
    display: flex;
    gap: 10px;
    padding: 12px;
    background: linear-gradient(135deg, var(--ui-bg) 0%, var(--ui-bg-subtle) 100%);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-lg);
  }

  .summary-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .summary-item label {
    font-weight: 500;
    font-size: 11px;
    color: var(--ui-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .pass-rate-display {
    font-size: 18px;
    font-weight: 600;
    padding: 8px 12px;
    border-radius: var(--ui-radius-md);
    text-align: center;
  }

  .pass-rate-display.pass {
    background: color-mix(in srgb, var(--ui-success) 10%, white);
    color: var(--ui-success);
    border: 1px solid color-mix(in srgb, var(--ui-success) 25%, transparent);
  }

  .pass-rate-display.partial {
    background: color-mix(in srgb, var(--ui-warning) 10%, white);
    color: var(--ui-warning);
    border: 1px solid color-mix(in srgb, var(--ui-warning) 25%, transparent);
  }

  .pass-rate-display.fail {
    background: color-mix(in srgb, var(--ui-danger) 10%, white);
    color: var(--ui-danger);
    border: 1px solid color-mix(in srgb, var(--ui-danger) 25%, transparent);
  }

  .pass-rate-display.no-data {
    background: var(--ui-bg-subtle);
    color: var(--ui-text-muted);
    border: 1px solid var(--ui-border);
  }

  .error-count-display {
    font-size: 18px;
    font-weight: 600;
    padding: 8px 12px;
    border-radius: var(--ui-radius-md);
    text-align: center;
    background: var(--ui-bg);
    color: var(--ui-text-strong);
    border: 1px solid var(--ui-border);
  }

  .error-count-display.has-errors {
    background: color-mix(in srgb, var(--ui-danger) 10%, white);
    color: var(--ui-danger);
    border: 1px solid color-mix(in srgb, var(--ui-danger) 25%, transparent);
  }
</style>

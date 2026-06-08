<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { ValidationReportErrorRow } from '@/services/validationReportViewModel'

  const props = defineProps<{
    groupName: string
    errors: ValidationReportErrorRow[]
  }>()

  const emit = defineEmits<{
    (e: 'navigate', error: ValidationReportErrorRow): void
  }>()

  const { t } = useI18n()
  const expanded = ref(true)
</script>

<template>
  <div class="fv-error-group">
    <div class="fv-error-group-header" @click="expanded = !expanded">
      <span class="fv-error-group-toggle">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :style="{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
      <span class="fv-error-group-name">{{ groupName }}</span>
      <span class="ui-badge is-danger">{{ errors.length }}</span>
    </div>
    <div v-show="expanded" class="fv-error-group-body">
      <div
        v-for="(error, idx) in errors"
        :key="idx"
        class="fv-error-item"
        @click="emit('navigate', error)"
      >
        <div class="fv-error-main">
          <div class="fv-error-topline">
            <span
              class="fv-error-badge"
              :class="{
                'is-danger': error.stage === 'constraint',
                'is-warning': error.stage === 'format',
                'is-info': error.stage === 'loading',
              }"
            >
              {{ error.stage }}
            </span>
            <span class="fv-error-type">{{ error.check_type || error.error_type }}</span>
          </div>
          <p class="fv-error-msg">{{ error.display_message }}</p>
          <p v-if="error.suggestion" class="fv-error-suggestion">
            {{ t('common.fullValidation.result.suggestion') }}: {{ error.suggestion }}
          </p>
          <div class="fv-error-meta">
            <span v-if="error.location" class="fv-error-location">{{ error.location }}</span>
          </div>
        </div>
        <button
          class="fv-error-navigate ui-btn ui-btn--ghost ui-btn--xs"
          type="button"
          @click.stop="emit('navigate', error)"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

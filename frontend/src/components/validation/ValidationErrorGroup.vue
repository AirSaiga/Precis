<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { FullValidationErrorItem } from '@/api/projectValidationApi'

  const props = defineProps<{
    groupName: string
    errors: FullValidationErrorItem[]
  }>()

  const emit = defineEmits<{
    (e: 'navigate', error: FullValidationErrorItem): void
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
        <span class="fv-error-msg">{{ error.message }}</span>
        <span class="fv-error-meta">
          <span v-if="error.table">{{ error.table }}</span>
          <span v-if="error.column">{{ error.column }}</span>
          <span v-if="typeof error.row_index === 'number'">
            {{ t('common.fullValidation.table.row') }} {{ error.row_index + 1 }}
          </span>
        </span>
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

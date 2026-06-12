<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  interface StageItem {
    key: string
    label: string
    description: string
    status: 'pending' | 'running' | 'success' | 'error' | 'attention' | 'skipped'
  }

  defineProps<{
    stages: StageItem[]
  }>()

  const { t } = useI18n()

  function getStatusIcon(status: StageItem['status']) {
    switch (status) {
      case 'success':
        return 'check'
      case 'error':
        return 'x'
      case 'running':
        return 'loader'
      case 'skipped':
        return 'skip'
      case 'attention':
        return 'alert'
      default:
        return 'circle'
    }
  }
</script>

<template>
  <div class="fv-timeline">
    <div
      v-for="(item, index) in stages"
      :key="item.key"
      class="fv-timeline-item"
      :class="`is-${item.status}`"
    >
      <div class="fv-timeline-left">
        <div class="fv-timeline-icon" :class="`is-${item.status}`">
          <svg
            v-if="getStatusIcon(item.status) === 'check'"
            width="14"
            height="14"
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
            v-else-if="getStatusIcon(item.status) === 'x'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <svg
            v-else-if="getStatusIcon(item.status) === 'loader'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <svg
            v-else-if="getStatusIcon(item.status) === 'skip'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 9l7-7 7 7" />
            <path d="M12 2v20" />
          </svg>
          <svg
            v-else-if="getStatusIcon(item.status) === 'alert'"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
            />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <svg
            v-else
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
          </svg>
        </div>
        <div
          v-if="index < stages.length - 1"
          class="fv-timeline-connector"
          :class="{ 'is-active': item.status === 'success' || item.status === 'running' }"
        />
      </div>
      <div class="fv-timeline-right">
        <div class="fv-timeline-name">{{ item.label }}</div>
        <div class="fv-timeline-desc">{{ item.description }}</div>
        <div class="fv-timeline-status" :class="`is-${item.status}`">
          {{ t(`common.fullValidation.task.stageStatus.${item.status}`) }}
        </div>
      </div>
    </div>
  </div>
</template>

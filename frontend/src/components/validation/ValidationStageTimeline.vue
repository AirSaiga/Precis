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
</script>

<template>
  <div class="fv-timeline">
    <div
      v-for="item in stages"
      :key="item.key"
      class="fv-timeline-item"
      :class="`is-${item.status}`"
    >
      <span class="fv-timeline-dot" />
      <span class="fv-timeline-name">{{ item.label }}</span>
      <span class="fv-timeline-desc">{{ item.description }}</span>
      <span class="fv-timeline-status">
        {{ t(`common.fullValidation.task.stageStatus.${item.status}`) }}
      </span>
    </div>
  </div>
</template>

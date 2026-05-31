<script setup lang="ts">
  defineProps<{
    progress: number
    currentTable?: string
    errorsFound: number
  }>()
</script>

<template>
  <div class="fv-progress-wrapper">
    <div class="fv-progress-header">
      <span class="fv-progress-percent">{{ progress }}%</span>
      <span v-if="currentTable" class="fv-progress-table">
        正在校验: {{ currentTable }}
      </span>
      <span class="fv-progress-errors">
        已发现错误: {{ errorsFound }}
      </span>
    </div>
    <div class="fv-progress">
      <div class="fv-progress-fill" :style="{ width: `${progress}%` }" />
    </div>
  </div>
</template>

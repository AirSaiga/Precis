<script setup lang="ts">
  defineProps<{
    filesLoaded: number
    filesTotal: number
    tablesLoaded: number
    tablesTotal: number
    errorsFound: number
    durationMs: number
  }>()
</script>

<template>
  <div class="fv-stats-mini">
    <div class="fv-stats-mini-item">
      <span class="fv-stats-mini-value">{{ filesLoaded }}/{{ filesTotal }}</span>
      <span class="fv-stats-mini-label">文件</span>
    </div>
    <div class="fv-stats-mini-item">
      <span class="fv-stats-mini-value">{{ tablesLoaded }}/{{ tablesTotal }}</span>
      <span class="fv-stats-mini-label">表</span>
    </div>
    <div class="fv-stats-mini-item">
      <span class="fv-stats-mini-value">{{ errorsFound }}</span>
      <span class="fv-stats-mini-label">错误</span>
    </div>
    <div class="fv-stats-mini-item">
      <span class="fv-stats-mini-value">{{ durationMs }}ms</span>
      <span class="fv-stats-mini-label">耗时</span>
    </div>
  </div>
</template>

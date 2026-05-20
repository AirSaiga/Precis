<!--
  @file AIGenerationSummary.vue
  @description AI 配置生成结果中的 Summary 统计展示子组件

  功能职责：
  - 展示生成结果的统计卡片（Schema 数、约束数、Regex 节点数）
  - 展示后端返回的 warnings 和硬件 warnings
  - 显示生成耗时

  Props:
    - config: AiGenerateV2ConfigResponse | null  生成结果
    - warnings: string[]                          后端警告信息
    - hardwareWarnings: string[]                  硬件警告信息
    - elapsedTimeText: string                     格式化后的耗时
-->
<template>
  <div class="summary-view">
    <div class="result-header">
      <h5 class="result-title">
        {{ t('aiConfigGenerator.result.generationComplete') }}
      </h5>
      <span class="elapsed-time">{{ t('aiConfigGenerator.progress.elapsed', { time: elapsedTimeText }) }}</span>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value text-blue">
          {{ Object.keys(config?.schemas || {}).length }}
        </div>
        <div class="stat-label">
          {{ t('aiConfigGenerator.result.stats.schemas') }}
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-value text-green">
          {{ constraintStats.total }}
        </div>
        <div class="stat-label">
          {{ t('aiConfigGenerator.result.stats.constraints') }}
        </div>
        <div class="stat-detail">
          <span class="detail-item"
            >{{ t('aiConfigGenerator.result.stats.standalone') }}:
            {{ constraintStats.standalone }}</span
          >
          <span class="detail-divider">|</span>
          <span class="detail-item"
            >{{ t('aiConfigGenerator.result.stats.inline') }}: {{ constraintStats.inline }}</span
          >
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-value text-purple">
          {{ Object.keys(config?.regex_nodes || {}).length }}
        </div>
        <div class="stat-label">
          {{ t('aiConfigGenerator.result.stats.regexNodes') }}
        </div>
      </div>
    </div>

    <div v-if="warnings.length" class="warnings-box">
      <h5>{{ t('aiConfigGenerator.result.warningsTitle') }}</h5>
      <ul>
        <li v-for="(w, idx) in warnings" :key="idx">{{ w }}</li>
      </ul>
    </div>

    <div v-if="hardwareWarnings.length" class="warnings-box hardware">
      <h5>{{ t('aiConfigGenerator.result.hardwareTitle') }}</h5>
      <ul>
        <li v-for="(w, idx) in hardwareWarnings" :key="idx">{{ w }}</li>
      </ul>
    </div>

    <div class="success-hint">
      {{ t('aiConfigGenerator.result.successHint') }}
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { calculateConstraintStats } from '@/utils/constraintCount'
  import type { AiGenerateV2ConfigResponse } from '@/types/ai'

  const props = defineProps<{
    config: AiGenerateV2ConfigResponse | null
    warnings: string[]
    hardwareWarnings: string[]
    elapsedTimeText: string
  }>()

  const { t } = useI18n()

  const constraintStats = computed(() =>
    calculateConstraintStats(props.config?.schemas, props.config?.constraints)
  )
</script>

<style scoped src="./GenerationSummary.styles.css"></style>

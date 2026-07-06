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
      <span class="elapsed-time">{{
        t('aiConfigGenerator.progress.elapsed', { time: elapsedTimeText })
      }}</span>
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

    <!-- Agent 优化指标 -->
    <div v-if="iterations && maxIterations" class="agent-metrics-box">
      <h5>{{ t('aiConfigGenerator.result.agentMetricsTitle') }}</h5>
      <div class="agent-metrics">
        <span class="metric-item">
          {{
            t('aiConfigGenerator.result.agentIterations', {
              current: iterations,
              max: maxIterations,
            })
          }}
        </span>
        <span v-if="metrics" class="metric-item">
          {{
            t('aiConfigGenerator.result.agentPassRate', {
              passed: metrics.passed_rules || 0,
              total: metrics.total_rules || 0,
            })
          }}
        </span>
        <span v-if="metrics?.failed_rules" class="metric-item warn">
          {{ t('aiConfigGenerator.result.agentIssues', { count: metrics.failed_rules }) }}
        </span>
      </div>
      <ul v-if="metrics?.issues?.length" class="issues-list">
        <li v-for="(issue, idx) in metrics.issues.slice(0, 5)" :key="idx">
          <span :class="['issue-badge', issue.severity || 'warning']">{{
            issue.severity || 'warning'
          }}</span>
          <span class="issue-message">{{ issue.message }}</span>
        </li>
      </ul>
    </div>

    <div v-if="warnings.length" class="warnings-box">
      <h5><AppIcon name="alert" :size="16" /> {{ t('aiConfigGenerator.result.warningsTitle') }}</h5>
      <ul>
        <li v-for="(w, idx) in warnings" :key="idx">{{ w }}</li>
      </ul>
    </div>

    <div v-if="hardwareWarnings.length" class="warnings-box hardware">
      <h5>
        <AppIcon name="monitor" :size="16" /> {{ t('aiConfigGenerator.result.hardwareTitle') }}
      </h5>
      <ul>
        <li v-for="(w, idx) in hardwareWarnings" :key="idx">{{ w }}</li>
      </ul>
    </div>

    <div class="success-hint">
      <AppIcon name="check-circle" :size="16" />
      {{ t('aiConfigGenerator.result.successHint') }}
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import { calculateConstraintStats } from '@/utils/constraintCount'
  import type { AiGenerateV2ConfigMetrics, AiGenerateV2ConfigResponse } from '@/types/ai'

  const props = defineProps<{
    config: AiGenerateV2ConfigResponse | null
    warnings: string[]
    hardwareWarnings: string[]
    elapsedTimeText: string
    iterations?: number
    maxIterations?: number
    metrics?: AiGenerateV2ConfigMetrics
  }>()

  const { t } = useI18n()

  const constraintStats = computed(() =>
    calculateConstraintStats(props.config?.schemas, props.config?.constraints)
  )
</script>

<style scoped src="./GenerationSummary.styles.css"></style>

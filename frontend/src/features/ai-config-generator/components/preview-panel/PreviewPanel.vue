<!--
  @file PreviewPanel.vue
  @description AI 配置生成模态框右侧预览面板

  功能职责：
  - 空状态：引导用户开始生成
  - 加载中：展示生成进度、阶段、流式字符数、耗时
  - 结果态：Tab 切换展示 Summary 统计和 YAML 代码预览
  - 提供应用到项目和关闭按钮

  Props:
    - state: 聚合的预览状态对象（替代 10 个独立 props）

  Emits:
    - apply:  用户点击应用到项目
    - close:  用户点击关闭
-->
<template>
  <div class="preview-panel">
    <div class="preview-header">
      <h4>{{ t('aiConfigGenerator.preview.title') }}</h4>
      <div class="preview-tabs" v-if="state.generatedConfig">
        <button
          class="tab-btn"
          :class="{ active: previewTab === 'summary' }"
          @click="previewTab = 'summary'"
        >
          {{ t('aiConfigGenerator.preview.tabs.summary') }}
        </button>
        <button
          class="tab-btn"
          :class="{ active: previewTab === 'code' }"
          @click="previewTab = 'code'"
        >
          {{ t('aiConfigGenerator.preview.tabs.code') }}
        </button>
      </div>
    </div>

    <div class="preview-body">
      <!-- Empty State -->
      <div v-if="!state.generating && !state.generatedConfig" class="empty-state">
        <div class="empty-icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
            />
            <path d="M20 3v4" />
            <path d="M22 5h-4" />
          </svg>
        </div>
        <h3>{{ t('aiConfigGenerator.empty.title') }}</h3>
        <p v-html="t('aiConfigGenerator.empty.descHtml')"></p>
      </div>

      <!-- Loading State -->
      <div v-else-if="state.generating" class="loading-state">
        <div class="loading-content">
          <div class="spinner-lg"></div>
          <h4>{{ t('aiConfigGenerator.progressTitle') }}</h4>
          <div class="timer">
            {{ t('aiConfigGenerator.progress.elapsed', { time: state.elapsedTimeText }) }}
          </div>

          <div class="progress-details">
            <div class="progress-step">
              <span class="label">{{ t('aiConfigGenerator.progress.stage') }}:</span>
              <span class="value highlight">{{ state.stageLabel }}</span>
            </div>
            <div v-if="state.iterations && state.maxIterations" class="progress-step">
              <span class="label">{{ t('aiConfigGenerator.progress.iteration') }}:</span>
              <span class="value">{{ state.iterations }} / {{ state.maxIterations }}</span>
            </div>
            <div class="progress-message">
              {{ state.progressMessage || t('aiConfigGenerator.progress.running') }}
            </div>
            <div v-if="state.currentPlan?.length" class="current-plan-box">
              <div class="plan-title">{{ t('aiConfigGenerator.progress.planTitle') }}</div>
              <div v-for="(plan, pIdx) in state.currentPlan" :key="pIdx" class="plan-item">
                <div class="plan-strategy">{{ (plan.strategy as string) || '' }}</div>
                <div class="plan-reason">{{ (plan.reason as string) || '' }}</div>
                <div v-if="Array.isArray(plan.chunks)" class="plan-chunks">
                  {{ t('aiConfigGenerator.progress.chunksCount', { count: plan.chunks.length }) }}
                </div>
              </div>
            </div>
            <div v-if="state.receivedChars > 0" class="stream-info">
              {{ t('aiConfigGenerator.progress.receivedChars', { count: state.receivedChars }) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Result State -->
      <div v-else-if="state.generatedConfig" class="result-state">
        <!-- Summary Tab -->
        <div v-show="previewTab === 'summary'" class="summary-tab">
          <GenerationSummary
            :config="state.generatedConfig"
            :warnings="state.warnings"
            :hardware-warnings="state.hardwareWarnings"
            :elapsed-time-text="state.elapsedTimeText"
            :iterations="state.iterations"
            :max-iterations="state.maxIterations"
            :metrics="state.metrics"
          />
        </div>

        <!-- Code Tab -->
        <div v-show="previewTab === 'code'" class="code-tab">
          <CodePreview :yaml-string="state.yamlString" />
        </div>
      </div>
    </div>

    <!-- Footer Actions (Only when result is ready) -->
    <div class="preview-footer" v-if="state.generatedConfig">
      <button class="close-text-btn" @click="emit('close')">
        {{ t('aiConfigGenerator.actions.close') }}
      </button>
      <button class="apply-btn" :disabled="state.applying" @click="emit('apply')">
        <span v-if="state.applying" class="spinner-sm"></span>
        {{
          state.applying
            ? t('aiConfigGenerator.actions.applying')
            : t('aiConfigGenerator.actions.apply')
        }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { AiGenerateV2ConfigMetrics, AiGenerateV2ConfigResponse } from '@/types/ai'
  import GenerationSummary from './GenerationSummary.vue'
  import CodePreview from './CodePreview.vue'

  /**
   * 聚合的预览面板状态接口
   * 由父组件（Modal）从各 composable 收集后传入
   */
  export interface PreviewState {
    generating: boolean
    generatedConfig: AiGenerateV2ConfigResponse | null
    elapsedTimeText: string
    warnings: string[]
    hardwareWarnings: string[]
    yamlString: string
    stageLabel: string
    progressMessage: string
    receivedChars: number
    applying: boolean
    iterations?: number
    maxIterations?: number
    metrics?: AiGenerateV2ConfigMetrics
    currentPlan?: Array<Record<string, unknown>>
  }

  const props = defineProps<{
    state: PreviewState
  }>()

  const emit = defineEmits<{
    apply: []
    close: []
  }>()

  const { t } = useI18n()
  const previewTab = ref<'summary' | 'code'>('summary')
</script>

<style scoped src="./PreviewPanel.styles.css"></style>

<!--
  @file AIGenerationPreview.vue
  @description AI 配置生成模态框右侧预览面板子组件

  功能职责：
  - 空状态：引导用户开始生成
  - 加载中：展示生成进度、阶段、流式字符数、耗时
  - 结果态：Tab 切换展示 Summary 统计和 YAML 代码预览
  - 提供应用到项目和关闭按钮

  Props:
    - generating: boolean                         是否正在生成
    - generatedConfig: AiGenerateV2ConfigResponse | null  生成结果
    - elapsedTimeText: string                     格式化耗时
    - warnings: string[]                          后端警告
    - hardwareWarnings: string[]                  硬件警告
    - yamlString: string                          YAML 预览文本
    - stageLabel: string                          当前阶段标签
    - progressMessage: string                     进度消息
    - receivedChars: number                       已接收字符数
    - applying: boolean                           是否正在应用

  Emits:
    - apply:  用户点击应用到项目
    - close:  用户点击关闭
-->
<template>
  <div class="preview-panel">
    <div class="preview-header">
      <h4>{{ t('aiConfigGenerator.preview.title') }}</h4>
      <div class="preview-tabs" v-if="generatedConfig">
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
      <div v-if="!generating && !generatedConfig" class="empty-state">
        <div class="empty-icon">🔮</div>
        <h3>{{ t('aiConfigGenerator.empty.title') }}</h3>
        <p v-html="t('aiConfigGenerator.empty.descHtml')"></p>
      </div>

      <!-- Loading State -->
      <div v-else-if="generating" class="loading-state">
        <div class="loading-content">
          <div class="spinner-lg"></div>
          <h4>{{ t('aiConfigGenerator.progressTitle') }}</h4>
          <div class="timer">
            {{ t('aiConfigGenerator.progress.elapsed', { time: elapsedTimeText }) }}
          </div>

          <div class="progress-details">
            <div class="progress-step">
              <span class="label">{{ t('aiConfigGenerator.progress.stage') }}:</span>
              <span class="value highlight">{{ stageLabel }}</span>
            </div>
            <div class="progress-message">
              {{ progressMessage || t('aiConfigGenerator.progress.running') }}
            </div>
            <div v-if="receivedChars > 0" class="stream-info">
              {{ t('aiConfigGenerator.progress.receivedChars', { count: receivedChars }) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Result State -->
      <div v-else-if="generatedConfig" class="result-state">
        <!-- Summary Tab -->
        <div v-show="previewTab === 'summary'" class="summary-tab">
          <AIGenerationSummary
            :config="generatedConfig"
            :warnings="warnings"
            :hardware-warnings="hardwareWarnings"
            :elapsed-time-text="elapsedTimeText"
          />
        </div>

        <!-- Code Tab -->
        <div v-show="previewTab === 'code'" class="code-tab">
          <AIGenerationCodePreview :yaml-string="yamlString" />
        </div>
      </div>
    </div>

    <!-- Footer Actions (Only when result is ready) -->
    <div class="preview-footer" v-if="generatedConfig">
      <button class="btn-text" @click="emit('close')">
        {{ t('aiConfigGenerator.actions.close') }}
      </button>
      <button class="btn-primary apply-btn" :disabled="applying" @click="emit('apply')">
        <span v-if="applying" class="spinner-sm"></span>
        {{
          applying ? t('aiConfigGenerator.actions.applying') : t('aiConfigGenerator.actions.apply')
        }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { AiGenerateV2ConfigResponse } from '@/types/ai'
  import AIGenerationSummary from './AIGenerationSummary.vue'
  import AIGenerationCodePreview from './AIGenerationCodePreview.vue'

  const props = defineProps<{
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
  }>()

  const emit = defineEmits<{
    apply: []
    close: []
  }>()

  const { t } = useI18n()
  const previewTab = ref<'summary' | 'code'>('summary')
</script>

<style scoped src="./AIGenerationPreview.styles.css"></style>

<!--
  @file AIProviderStatusCard.vue
  @description AI 配置生成模态框中的 AI Provider 状态展示子组件

  功能职责：
  - 纯展示当前配置的 AI Provider 信息
  - 显示 Provider 名称、模型、配置状态
  - 未配置时展示警告样式

  Props:
    - provider: CloudAIProviderResponse | null  当前 AI Provider
-->
<template>
  <div class="current-ai-info">
    <div v-if="provider" class="ai-provider-card">
      <div class="ai-provider-icon">
        {{ provider.provider === 'ollama' ? '🖥️' : '☁️' }}
      </div>
      <div class="ai-provider-details">
        <div class="ai-provider-name">{{ provider.name }}</div>
        <div class="ai-provider-model">{{ provider.model }}</div>
      </div>
      <div class="ai-provider-status" :class="{ configured: provider.is_configured }">
        {{
          provider.is_configured
            ? t('aiConfigGenerator.modelStatus.configured')
            : t('aiConfigGenerator.modelStatus.notConfigured')
        }}
      </div>
    </div>
    <div v-else class="ai-provider-card not-configured">
      <div class="ai-provider-icon">⚠️</div>
      <div class="ai-provider-details">
        <div class="ai-provider-name">
          {{ t('aiConfigGenerator.modelStatus.noProvider') }}
        </div>
        <div class="ai-provider-model">
          {{ t('aiConfigGenerator.modelStatus.pleaseConfigure') }}
        </div>
      </div>
    </div>
    <div class="ai-info-hint">
      {{ t('aiConfigGenerator.modelStatus.hint') }}
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import type { CloudAIProviderResponse } from '@/types/ai'

  interface Props {
    provider: CloudAIProviderResponse | null
  }

  defineProps<Props>()

  const { t } = useI18n()
</script>

<style scoped src="./AIProviderStatusCard.styles.css"></style>

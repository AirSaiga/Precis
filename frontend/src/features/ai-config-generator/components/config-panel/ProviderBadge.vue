<!--
  @file ProviderBadge.vue
  @description 紧凑的 AI Provider 状态徽章

  功能职责：
  - 单行高度行内展示 Provider 图标 + 名称 + 模型 + 状态点
  - 未配置时显示警告样式和提示文字
  - 嵌入到 Generate 按钮上方，不占用独立 Section

  Props:
    - provider: CloudAIProviderResponse | null  当前 AI Provider
-->
<template>
  <div class="provider-badge" :class="{ 'not-configured': !provider?.is_configured }">
    <template v-if="provider">
      <span class="provider-icon">
        <!-- Ollama: 本地服务器图标 -->
        <svg v-if="provider.provider === 'ollama'" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>
        <!-- 云端 API 图标 -->
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
      </span>
      <span class="provider-name">{{ provider.name }}</span>
      <span class="provider-separator">·</span>
      <span class="provider-model">{{ provider.model }}</span>
      <span class="status-dot" :class="provider.is_configured ? 'ok' : 'warn'" />
    </template>
    <template v-else>
      <span class="provider-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      </span>
      <span class="provider-name warning">
        {{ t('aiConfigGenerator.modelStatus.noProvider') }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import type { CloudAIProviderResponse } from '@/types/ai'

  defineProps<{
    provider: CloudAIProviderResponse | null
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./ProviderBadge.styles.css"></style>

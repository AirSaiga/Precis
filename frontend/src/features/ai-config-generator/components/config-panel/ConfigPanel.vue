<!--
  @file ConfigPanel.vue
  @description AI 配置生成器左面板：文件选择 + 选项 + 操作按钮

  功能职责：
  - 文件选择（FileSelector）
  - 生成选项（OptionsPanel）
  - Provider 状态徽章 + 生成/取消按钮（panel-actions 区域）

  直接从 store 读取共享状态，不需要 props 传递。
-->
<template>
  <div class="config-panel">
    <!-- Section 1: Data Sources -->
    <div class="config-section">
      <div class="section-header">
        <span class="step-badge">1</span>
        <span class="section-title">{{ t('aiConfigGenerator.sections.dataSource') }}</span>
      </div>
      <FileSelector
        :checked-files="checkedFiles"
        :expanded-files="expandedFiles"
        :is-expanding="isExpanding"
        :selected-paths="selectedPaths"
        @pick-files="pickFiles"
        @pick-folders="pickFolders"
        @toggle-file="toggleFile"
        @toggle-all="toggleAllFiles"
        @clear="clearSelection"
      />
    </div>

    <!-- Section 2: Generation Options -->
    <div class="config-section">
      <div class="section-header">
        <span class="step-badge">2</span>
        <span class="section-title">{{
          t('aiConfigGenerator.sections.generationOptions')
        }}</span>
      </div>
      <OptionsPanel
        :options="store.options"
        :advanced-visible="store.advancedOptionsVisible"
        @update:options="store.options = $event"
        @update:advanced-visible="store.advancedOptionsVisible = $event"
        @reset-defaults="store.options = createDefaultOptions()"
      />
    </div>

    <!-- Bottom Actions: Provider Badge + Generate Button -->
    <div class="panel-actions">
      <ProviderBadge :provider="store.activeProvider" />
      <button
        class="big-generate-btn"
        type="button"
        :disabled="
          generating || checkedFiles.size === 0 || !store.activeProvider?.is_configured
        "
        :title="
          !store.activeProvider?.is_configured
            ? t('aiConfigGenerator.errors.modelNotConfigured')
            : ''
        "
        @click="emit('generate')"
      >
        <span v-if="generating" class="spinner-sm"></span>
        {{
          generating
            ? t('aiConfigGenerator.actions.generating')
            : t('aiConfigGenerator.actions.startGeneration')
        }}
      </button>

      <button
        v-if="generating"
        class="cancel-btn"
        type="button"
        :disabled="canceling"
        @click="emit('cancel')"
      >
        {{
          canceling
            ? t('aiConfigGenerator.actions.canceling')
            : t('aiConfigGenerator.actions.cancel')
        }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  import { createDefaultOptions } from '../../services/generationOptions'
  import { useAiConfigGeneratorStore } from '../../stores/aiConfigGeneratorStore'
  import FileSelector from './FileSelector.vue'
  import OptionsPanel from './OptionsPanel.vue'
  import ProviderBadge from './ProviderBadge.vue'

  defineProps<{
    checkedFiles: Set<string>
    expandedFiles: string[]
    isExpanding: boolean
    selectedPaths: string[]
    generating: boolean
    canceling: boolean
  }>()

  const emit = defineEmits<{
    generate: []
    cancel: []
    'pick-files': []
    'pick-folders': []
    'toggle-file': [file: string]
    'toggle-all': []
    clear: []
  }>()

  const { t } = useI18n()
  const store = useAiConfigGeneratorStore()

  // 文件选择操作由父组件的 fileSelection composable 提供
  const pickFiles = () => emit('pick-files')
  const pickFolders = () => emit('pick-folders')
  const toggleFile = (file: string) => emit('toggle-file', file)
  const toggleAllFiles = () => emit('toggle-all')
  const clearSelection = () => emit('clear')
</script>

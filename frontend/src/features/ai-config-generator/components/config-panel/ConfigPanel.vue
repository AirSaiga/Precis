<!--
  @file ConfigPanel.vue
  @description AI 配置生成器顶部操作条（原左侧面板）

  功能职责：
  - 文件选择按钮 + 已选文件计数（可折叠展开文件列表）
  - Provider 状态徽章
  - 生成/取消按钮

  移除了原 Step 2（生成选项），所有参数使用硬编码默认值。
-->
<template>
  <div class="action-bar">
    <div class="action-bar-main">
      <!-- 文件选择按钮 -->
      <div class="file-actions">
        <button class="action-btn" type="button" @click="emit('pick-files')">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          </svg>
          {{ t('aiConfigGenerator.actions.pickFiles') }}
        </button>
        <button class="action-btn" type="button" @click="emit('pick-folders')">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
            />
          </svg>
          {{ t('aiConfigGenerator.actions.pickFolders') }}
        </button>
      </div>

      <!-- 已选文件计数（可点击展开） -->
      <button
        v-if="selectedPaths.length"
        class="file-summary-btn"
        type="button"
        @click="fileListExpanded = !fileListExpanded"
      >
        <span v-if="isExpanding" class="spinner-sm"></span>
        <span class="summary-text">
          {{ t('aiConfigGenerator.selectedCount', { count: checkedFiles.size }) }} /
          {{ expandedFiles.length }}
        </span>
        <svg
          class="chevron"
          :class="{ expanded: fileListExpanded }"
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <!-- 无文件提示 -->
      <span v-else class="no-files-hint">{{ t('aiConfigGenerator.noFiles') }}</span>

      <!-- 弹性间隔 -->
      <div class="action-spacer"></div>

      <!-- Provider 徽章 -->
      <ProviderBadge :provider="store.activeProvider" />

      <!-- 生成按钮 -->
      <button
        class="generate-btn"
        type="button"
        :disabled="generating || checkedFiles.size === 0 || !store.activeProvider?.is_configured"
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

      <!-- 取消按钮 -->
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

    <!-- 折叠文件列表 -->
    <div v-if="fileListExpanded && selectedPaths.length" class="file-list-dropdown">
      <div class="file-list-header">
        <span class="file-list-title">{{ t('aiConfigGenerator.sections.dataSource') }}</span>
        <div class="header-actions">
          <button class="text-btn" @click="emit('toggle-all')" :disabled="isExpanding">
            {{
              checkedFiles.size === expandedFiles.length
                ? t('aiConfigGenerator.actions.selectNone')
                : t('aiConfigGenerator.actions.selectAll')
            }}
          </button>
          <button
            class="clear-btn"
            @click="
              emit('clear');
              fileListExpanded = false
            "
          >
            {{ t('aiConfigGenerator.actions.clear') }}
          </button>
        </div>
      </div>
      <div class="file-list-scroll">
        <div v-if="isExpanding" class="loading-placeholder">
          {{ t('aiConfigGenerator.fileList.loading') }}
        </div>
        <div
          v-else
          v-for="p in expandedFiles"
          :key="p"
          class="file-item"
          :class="{ disabled: !checkedFiles.has(p) }"
          :title="p"
          @click="emit('toggle-file', p)"
        >
          <input
            type="checkbox"
            :checked="checkedFiles.has(p)"
            @click.stop="emit('toggle-file', p)"
          />
          <span class="file-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
              <path d="M14 2v4a2 2 0 0 0 2 2h4" />
            </svg>
          </span>
          <span class="file-path">{{ p.split(/[\\/]/).pop() }}</span>
          <span class="file-path-full">{{ p }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { useAiConfigGeneratorStore } from '../../stores/aiConfigGeneratorStore'
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
  const fileListExpanded = ref(false)
</script>

<style scoped src="./ConfigPanel.styles.css"></style>

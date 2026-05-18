<!--
  @file AIConfigFileSelector.vue
  @description AI 配置生成模态框中的文件选择区域子组件

  功能职责：
  - 提供文件/文件夹选择按钮
  - 展示展开后的文件列表及勾选状态
  - 支持全选/反选、清空等批量操作

  Props:
    - checkedFiles: Set<string>  当前勾选的文件集合
    - expandedFiles: string[]     展开后的文件列表
    - isExpanding: boolean        是否正在展开路径
    - selectedPaths: string[]     原始选择的路径（用于判断是否有文件）

  Emits:
    - pick-files:  用户点击选择文件按钮
    - pick-folders: 用户点击选择文件夹按钮
    - toggle-file:  [file: string] 切换单个文件勾选
    - toggle-all:   全选/反选
    - clear:        清空所有选择
-->
<template>
  <div class="file-selection-area">
    <div class="file-actions">
      <button class="btn-secondary file-btn" type="button" @click="emit('pick-files')">
        <span class="icon">📄</span> {{ t('aiConfigGenerator.actions.pickFiles') }}
      </button>
      <button class="btn-secondary file-btn" type="button" @click="emit('pick-folders')">
        <span class="icon">📁</span> {{ t('aiConfigGenerator.actions.pickFolders') }}
      </button>
    </div>

    <div v-if="selectedPaths.length" class="file-list-container">
      <div class="file-list-header">
        <div v-if="isExpanding" class="spinner-sm" style="margin-right: 8px"></div>
        <span v-else
          >{{ t('aiConfigGenerator.selectedCount', { count: checkedFiles.size }) }} /
          {{ expandedFiles.length }}</span
        >

        <div class="header-actions">
          <button class="text-btn" @click="emit('toggle-all')" :disabled="isExpanding">
            {{
              checkedFiles.size === expandedFiles.length
                ? t('aiConfigGenerator.actions.selectNone')
                : t('aiConfigGenerator.actions.selectAll')
            }}
          </button>
          <button class="clear-btn" @click="emit('clear')">
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
          <span class="file-icon">📄</span>
          <span class="file-path">{{ p.split(/[\\/]/).pop() }}</span>
          <span class="file-path-full">{{ p }}</span>
        </div>
      </div>
    </div>
    <div v-else class="empty-files-hint">
      {{ t('aiConfigGenerator.noFiles') }}
    </div>
  </div>
</template>

<script setup lang="ts">
  import { useI18n } from 'vue-i18n'

  interface Props {
    checkedFiles: Set<string>
    expandedFiles: string[]
    isExpanding: boolean
    selectedPaths: string[]
  }

  defineProps<Props>()

  const emit = defineEmits<{
    'pick-files': []
    'pick-folders': []
    'toggle-file': [file: string]
    'toggle-all': []
    clear: []
  }>()

  const { t } = useI18n()
</script>

<style scoped src="./AIConfigFileSelector.styles.css"></style>

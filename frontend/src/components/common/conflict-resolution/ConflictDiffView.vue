<!--
  @file ConflictDiffView.vue
  @description 冲突差异详情视图组件

  功能概述:
  - 展示选中冲突项的 diff 头部信息（类型、ID、changesCount、操作按钮）
  - 通过两个 ConflictDiffPane 展示原始与生成配置的双栏对比
  - 管理两侧面板的滚动同步
  - 处理空状态

  Props:
    - selectedItem: ConfigItemDiff<unknown> | null   当前选中的冲突项
    - resolutions: Record<string, string>            全局解决策略
    - partialResolutions: Record<string, Record<string, string>>  逐行策略
    - diffLines: { original: DiffLine[]; generated: DiffLine[] }  差异行数据

  Emits:
    - set-resolution: [id, resolution]               设置整体解决策略
    - set-line-resolution: [id, keyPath, side]       设置逐行解决策略
-->
<template>
  <div class="diff-view">
    <div class="diff-header">
      <div class="diff-info">
        <span class="diff-type" :class="selectedItem.type">
          <span class="type-icon">{{ getStatusIcon(selectedItem.type) }}</span>
          {{ selectedItem.type.toUpperCase() }}
        </span>
        <span class="diff-id">{{ selectedItem.id }}</span>
        <span v-if="selectedItem.changes?.length" class="changes-count">
          {{ t('aiConfigGenerator.conflict.changesCount', { count: selectedItem.changes.length }) }}
        </span>
      </div>
      <div class="diff-actions">
        <label
          class="radio-card"
          :class="{
            active: resolutions[selectedItem.id] === 'original',
            disabled: !selectedItem.original,
          }"
        >
          <input
            type="radio"
            :name="'res-' + selectedItem.id"
            value="original"
            :checked="resolutions[selectedItem.id] === 'original'"
            @change="$emit('set-resolution', selectedItem.id, 'original')"
            :disabled="!selectedItem.original"
          />
          <span class="radio-icon"><AppIcon name="file" :size="14" /></span>
          <span class="radio-text">{{ t('aiConfigGenerator.conflict.actions.keepOriginal') }}</span>
        </label>
        <label
          class="radio-card"
          :class="{
            active: resolutions[selectedItem.id] === 'generated',
            disabled: !selectedItem.generated,
          }"
        >
          <input
            type="radio"
            :name="'res-' + selectedItem.id"
            value="generated"
            :checked="resolutions[selectedItem.id] === 'generated'"
            @change="$emit('set-resolution', selectedItem.id, 'generated')"
            :disabled="!selectedItem.generated"
          />
          <span class="radio-icon"><AppIcon name="sparkles" :size="14" /></span>
          <span class="radio-text">{{ t('aiConfigGenerator.conflict.actions.useGenerated') }}</span>
        </label>
      </div>
    </div>

    <div class="diff-content">
      <ConflictDiffPane
        ref="originalPaneRef"
        :lines="diffLines.original"
        :title="t('aiConfigGenerator.conflict.panes.original')"
        :badge="
          selectedItem.original ? t('aiConfigGenerator.conflict.panes.badgeOriginal') : undefined
        "
        side="original"
        :resolutions="resolutions"
        :partialResolutions="partialResolutions"
        :selectedItemId="selectedItem.id"
        :emptyText="t('aiConfigGenerator.conflict.panes.noOriginal')"
        @scroll="handleOriginalScroll"
        @set-line-resolution="
          (keyPath, side) => $emit('set-line-resolution', selectedItem.id, keyPath, side)
        "
      />
      <ConflictDiffPane
        ref="generatedPaneRef"
        :lines="diffLines.generated"
        :title="t('aiConfigGenerator.conflict.panes.generated')"
        :badge="
          selectedItem.generated ? t('aiConfigGenerator.conflict.panes.badgeGenerated') : undefined
        "
        side="generated"
        :resolutions="resolutions"
        :partialResolutions="partialResolutions"
        :selectedItemId="selectedItem.id"
        :emptyText="t('aiConfigGenerator.conflict.panes.noGenerated')"
        @scroll="handleGeneratedScroll"
        @set-line-resolution="
          (keyPath, side) => $emit('set-line-resolution', selectedItem.id, keyPath, side)
        "
      />
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import AppIcon from '@/components/icons/AppIcon.vue'
  import ConflictDiffPane from './ConflictDiffPane.vue'
  import type { ConfigItemDiff } from '@/api/types/conflict'
  import type { DiffLine } from '@/composables/conflict/useConflictDiffEngine'
  interface Props {
    selectedItem: ConfigItemDiff<unknown>
    resolutions: Record<string, string>
    partialResolutions: Record<string, Record<string, string>>
    diffLines: {
      original: DiffLine[]
      generated: DiffLine[]
    }
  }

  defineProps<Props>()

  defineEmits<{
    'set-resolution': [id: string, resolution: 'original' | 'generated']
    'set-line-resolution': [id: string, keyPath: string, side: 'original' | 'generated']
  }>()

  const { t } = useI18n()

  const originalPaneRef = ref<InstanceType<typeof ConflictDiffPane> | null>(null)
  const generatedPaneRef = ref<InstanceType<typeof ConflictDiffPane> | null>(null)
  let isSyncing = false

  const handleOriginalScroll = () => {
    if (isSyncing || !originalPaneRef.value?.linesRef || !generatedPaneRef.value?.linesRef) return
    isSyncing = true
    generatedPaneRef.value.linesRef.scrollTop = originalPaneRef.value.linesRef.scrollTop
    setTimeout(() => {
      isSyncing = false
    }, 50)
  }

  const handleGeneratedScroll = () => {
    if (isSyncing || !originalPaneRef.value?.linesRef || !generatedPaneRef.value?.linesRef) return
    isSyncing = true
    originalPaneRef.value.linesRef.scrollTop = generatedPaneRef.value.linesRef.scrollTop
    setTimeout(() => {
      isSyncing = false
    }, 50)
  }

  const getStatusIcon = (type: string) => {
    switch (type) {
      case 'added':
        return '+'
      case 'modified':
        return '~'
      default:
        return '•'
    }
  }
</script>

<style scoped src="./ConflictDiffView.styles.css"></style>

<!--
  @file ConflictDiffPane.vue
  @description 差异对比单个面板组件

  功能概述:
  - 展示原始配置或生成配置的扁平化 diff 行列表
  - 为变更行提供逐行选择按钮（保留原行 / 应用生成行）
  - 支持内容高亮渲染
  - 暴露 linesRef 供父组件进行滚动同步

  Props:
    - lines: DiffLine[]                      要展示的差异行列表
    - title: string                          面板标题
    - badge: string                          右上角徽章文本（可选）
    - side: 'original' | 'generated'         面板所属侧
    - resolutions: Record<string, string>    全局解决策略
    - partialResolutions: Record<string, Record<string, string>>  逐行策略
    - selectedItemId: string                 当前选中项 ID

  Emits:
    - set-line-resolution: [keyPath, side]   用户点击逐行选择按钮
    - scroll: []                             面板发生滚动事件
-->
<template>
  <div class="diff-pane" :class="side">
    <div class="pane-header">
      <span class="pane-title">{{ title }}</span>
      <span v-if="badge" class="pane-badge" :class="side">{{ badge }}</span>
    </div>
    <div class="diff-lines" ref="linesRef" @scroll="$emit('scroll')">
      <template v-if="lines.length">
        <div
          v-for="(line, idx) in lines"
          :key="side + '-' + idx"
          class="diff-line"
          :class="line.type"
        >
          <span class="line-num">{{ idx + 1 }}</span>
          <div class="line-actions" v-if="line.type !== 'unchanged' && line.keyPath">
            <button
              class="line-btn"
              :class="{ active: isLineSelected(line.keyPath) }"
              @click="$emit('set-line-resolution', line.keyPath, side)"
              :title="
                side === 'original'
                  ? t('aiConfigGenerator.conflict.actions.keepLine')
                  : t('aiConfigGenerator.conflict.actions.applyLine')
              "
            >
              {{ side === 'original' ? '<' : '>' }}
            </button>
          </div>
          <span class="line-prefix">{{ line.prefix }}</span>
          <span class="line-content" v-html="highlightChanges(line.content, line.changes)"></span>
        </div>
      </template>
      <div v-else class="empty-pane">
        <span>{{ emptyText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { highlightChanges } from '@/composables/conflict/useConflictDiffEngine'
  import type { DiffLine } from '@/composables/conflict/useConflictDiffEngine'

  interface Props {
    lines: DiffLine[]
    title: string
    badge?: string
    side: 'original' | 'generated'
    resolutions: Record<string, string>
    partialResolutions: Record<string, Record<string, string>>
    selectedItemId: string
    emptyText: string
  }

  const props = defineProps<Props>()

  const emit = defineEmits<{
    'set-line-resolution': [keyPath: string, side: 'original' | 'generated']
    scroll: []
  }>()

  const { t } = useI18n()
  const linesRef = ref<HTMLElement | null>(null)

  const isLineSelected = (keyPath: string | undefined) => {
    if (!keyPath) return false

    const mainRes = props.resolutions[props.selectedItemId]

    if (mainRes !== 'mixed') {
      return mainRes === props.side
    }

    const lineRes = props.partialResolutions[props.selectedItemId]?.[keyPath]

    if (lineRes) {
      return lineRes === props.side
    }

    return props.side === 'original'
  }

  defineExpose({ linesRef })
</script>

<style scoped src="./ConflictDiffPane.styles.css"></style>

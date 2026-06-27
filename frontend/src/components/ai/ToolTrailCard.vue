<!--
  @file ToolTrailCard.vue
  @description 工具调用轨迹折叠卡组件

  形态（方案 A）：
  - 折叠态：单行 "🔧 已完成 N 步" / "执行中..." / "已取消"
  - 展开态：列出每步 ✓(成功)/⟳(进行中)/✗(失败) + label + actionCount

  Props:
    - steps: ToolStep[] 工具步骤
    - status: 'streaming' | 'completed' | 'cancelled' | 'error'
    - completedTurns?: number 取消时的已执行轮次
-->
<template>
  <div v-if="steps.length > 0 || status === 'cancelled'" class="tool-trail-card">
    <button class="trail-header" type="button" @click="toggle">
      <span class="trail-icon">🔧</span>
      <span class="trail-summary">{{ summaryText }}</span>
      <span class="trail-toggle" :class="{ expanded: isExpanded }">▾</span>
    </button>
    <div v-if="isExpanded" class="trail-body">
      <div v-for="(step, idx) in steps" :key="idx" class="trail-step" :class="step.status">
        <span class="step-indicator">{{ statusIndicator(step.status) }}</span>
        <span class="step-label">{{ step.label }}</span>
        <span v-if="step.actionCount" class="step-count">({{ step.actionCount }})</span>
        <span v-if="step.error" class="step-error">{{ step.error }}</span>
      </div>
      <div v-if="status === 'cancelled'" class="trail-cancelled-note">
        {{ cancelledNote }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { ToolStep } from '@/composables/shared/useStreamingMessage'

  interface Props {
    steps: ToolStep[]
    status: 'streaming' | 'completed' | 'cancelled' | 'error'
    completedTurns?: number
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  // 折叠状态：流式中默认展开（看实时进度），完成后自动折叠
  const isExpanded = ref(true)

  // 完成后自动折叠（watch 监听 status 变化，避免 computed 副作用）
  watch(
    () => props.status,
    (newStatus) => {
      if (newStatus !== 'streaming') {
        isExpanded.value = false
      }
    }
  )

  function toggle() {
    isExpanded.value = !isExpanded.value
  }

  const successCount = computed(() => props.steps.filter((s) => s.status === 'success').length)
  const failedCount = computed(() => props.steps.filter((s) => s.status === 'failed').length)

  const summaryText = computed(() => {
    const total = props.steps.length
    if (props.status === 'cancelled') {
      return t('aiChat.trailCancelled', { turns: props.completedTurns ?? 0, steps: total })
    }
    if (props.status === 'streaming') {
      return t('aiChat.trailRunning', { done: successCount.value + failedCount.value, total })
    }
    // completed / error
    if (failedCount.value > 0) {
      return t('aiChat.trailDoneWithFail', { total, failed: failedCount.value })
    }
    return t('aiChat.trailDone', { total })
  })

  const cancelledNote = computed(() =>
    t('aiChat.trailCancelledNote', { turns: props.completedTurns ?? 0 })
  )

  function statusIndicator(status: ToolStep['status']): string {
    if (status === 'success') return '✓'
    if (status === 'running') return '⟳'
    return '✗'
  }
</script>

<style scoped>
  .tool-trail-card {
    margin: 4px 0;
    border: 1px solid var(--border-color, #333);
    border-radius: 6px;
    overflow: hidden;
    font-size: 12px;
  }
  .trail-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: transparent;
    border: none;
    color: var(--text-secondary, #9ca3af);
    cursor: pointer;
    text-align: left;
  }
  .trail-icon {
    font-size: 11px;
  }
  .trail-summary {
    flex: 1;
  }
  .trail-toggle {
    transition: transform 0.15s;
  }
  .trail-toggle.expanded {
    transform: rotate(180deg);
  }
  .trail-body {
    padding: 4px 10px 8px 24px;
    border-top: 1px solid var(--border-color, #333);
  }
  .trail-step {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 3px 0;
    color: var(--text-primary, #e0e0e0);
  }
  .step-indicator {
    width: 14px;
    font-weight: bold;
  }
  .trail-step.success .step-indicator {
    color: #34d399;
  }
  .trail-step.running .step-indicator {
    color: #fbbf24;
  }
  .trail-step.failed .step-indicator {
    color: #f87171;
  }
  .step-count {
    color: var(--text-secondary, #9ca3af);
    font-size: 11px;
  }
  .step-error {
    color: #f87171;
    font-size: 11px;
    margin-left: 4px;
  }
  .trail-cancelled-note {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color, #444);
    color: var(--text-secondary, #9ca3af);
    font-style: italic;
  }
</style>

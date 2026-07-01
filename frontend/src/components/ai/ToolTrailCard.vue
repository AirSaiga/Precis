<!--
  @file ToolTrailCard.vue
  @description 工具调用轨迹折叠卡组件

  形态（方案 A）：
  - 折叠态：单行 "已完成 N 步" / "执行中..." / "已取消" + 最近 2 个关键步骤 chip
  - 展开态：列出每步 ✓(成功)/⟳(进行中)/✗(失败) + label + actionCount

  Props:
    - steps: ToolStep[] 工具步骤
    - status: 'streaming' | 'completed' | 'cancelled' | 'error'
    - completedTurns?: number 取消时的已执行轮次
-->
<template>
  <div
    v-if="steps.length > 0 || status === 'cancelled'"
    class="tool-trail-card"
    :class="{ 'has-failed': hasFailed }"
  >
    <button class="trail-header" type="button" @click="toggle">
      <span class="trail-icon">
        <!-- 齿轮+扳手 SVG 图标 -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
          />
        </svg>
      </span>
      <span class="trail-summary">{{ summaryText }}</span>
      <span v-if="recentSteps.length > 0" class="trail-chips">
        <span v-for="(step, idx) in recentSteps" :key="idx" class="trail-chip" :class="step.status">
          <span class="chip-dot" />
          <span class="chip-label">{{ step.label }}</span>
        </span>
        <span v-if="hiddenStepsCount > 0" class="trail-chip-more"> +{{ hiddenStepsCount }} </span>
      </span>
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
  const hasFailed = computed(() => failedCount.value > 0)

  // 折叠态显示最近 2 个关键步骤 chip
  // 优先显示失败的步骤(failed 排前),其余保持原顺序;最后取最近 2 个
  const recentSteps = computed(() => {
    const failed = props.steps.filter((s) => s.status === 'failed')
    const others = props.steps.filter((s) => s.status !== 'failed')
    // 失败在前,其余按原顺序;取最后 2 个(最近的)
    return [...failed, ...others].slice(-2)
  })

  // 隐藏的步骤数量
  const hiddenStepsCount = computed(() => Math.max(0, props.steps.length - 2))

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
    margin: var(--ui-space-sm) 0;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-sm);
    overflow: hidden;
    font-size: var(--ui-font-size-sm);
  }
  .tool-trail-card.has-failed {
    border-left: 3px solid var(--ui-danger);
  }
  .trail-header {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    width: 100%;
    padding: var(--ui-space-sm) 10px;
    background: transparent;
    border: none;
    color: var(--ui-text-secondary);
    cursor: pointer;
    text-align: left;
  }
  .trail-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ui-text-secondary);
  }
  .trail-summary {
    flex-shrink: 0;
  }
  .trail-chips {
    display: flex;
    align-items: center;
    gap: var(--ui-space-xs);
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .trail-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: var(--ui-radius-sm);
    background: var(--ui-bg-muted);
    font-size: var(--ui-font-size-xs);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .trail-chip.success .chip-dot {
    background: var(--ui-success);
  }
  .trail-chip.running .chip-dot {
    background: var(--ui-warning);
  }
  .trail-chip.failed .chip-dot {
    background: var(--ui-danger);
  }
  .chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trail-chip-more {
    color: var(--ui-text-secondary);
    font-size: var(--ui-font-size-xs);
    flex-shrink: 0;
  }
  .trail-toggle {
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .trail-toggle.expanded {
    transform: rotate(180deg);
  }
  .trail-body {
    padding: var(--ui-space-xs) 10px var(--ui-space-sm) 24px;
    border-top: 1px solid var(--ui-border);
  }
  .trail-step {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    margin: 3px 0;
    color: var(--ui-text-primary);
  }
  .step-indicator {
    width: 14px;
    font-weight: bold;
  }
  .trail-step.success .step-indicator {
    color: var(--ui-success);
  }
  .trail-step.running .step-indicator {
    color: var(--ui-warning);
  }
  .trail-step.failed .step-indicator {
    color: var(--ui-danger);
  }
  .step-count {
    color: var(--ui-text-secondary);
    font-size: var(--ui-font-size-xs);
  }
  .step-error {
    color: var(--ui-danger);
    font-size: var(--ui-font-size-xs);
    margin-left: var(--ui-space-sm);
  }
  .trail-cancelled-note {
    margin-top: var(--ui-space-sm);
    padding-top: var(--ui-space-sm);
    border-top: 1px dashed var(--ui-border-light);
    color: var(--ui-text-secondary);
    font-style: italic;
  }
</style>

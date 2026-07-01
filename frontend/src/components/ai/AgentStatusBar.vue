<!--
  @file AgentStatusBar.vue
  @description Agent 模式状态栏组件

  显示当前 AI 对话状态：
  - 空闲（隐藏或提示）
  - 思考中（accent 呼吸）
  - 调用工具中 · {label}（accent 呼吸）
  - 等待确认 · {N}文件（warning 脉冲）
  - 出错（danger）
  - 已取消（灰）
  - 已完成（2s后淡出）

  Props:
    - streaming: StreamingMessage | null 当前流式消息
    - loading: boolean 是否正在加载
-->

<template>
  <div v-if="visible" class="agent-status-bar" :class="statusClass">
    <div class="status-indicator" :class="indicatorClass" />
    <span class="status-text">{{ statusText }}</span>
    <span v-if="elapsedTime" class="status-elapsed">{{ elapsedTime }}</span>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, watch, onUnmounted } from 'vue'
  import { useI18n } from 'vue-i18n'
  import type { StreamingMessage } from '@/composables/shared/useStreamingMessage'

  interface Props {
    streaming: StreamingMessage | null
    loading: boolean
  }

  const props = defineProps<Props>()
  const { t } = useI18n()

  /** 计时器 */
  const elapsedSeconds = ref(0)
  let timerInterval: ReturnType<typeof setInterval> | null = null

  /** 淡出计时器（完成后 2s 淡出） */
  const isFadingOut = ref(false)
  let fadeOutTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 最近一次的 completed 状态缓存。
   *
   * store 在 streaming.status 变为 'completed' 的同一 tick 会把 streaming 置 null
   * （aiChatStore.ts:484）,导致本组件 streaming prop 立即变 null,2s 淡出来不及触发。
   * 用此本地标记在 streaming 归 null 后仍保留「已完成」态 2s,供淡出动画播放。
   */
  const lastCompleted = ref(false)

  /** 状态文本 */
  const statusText = computed(() => {
    if (!props.streaming) {
      // streaming 已 null:loading 态显示思考中;最近刚完成则显示已完成(供 2s 淡出)
      if (lastCompleted.value) return t('aiChat.statusCompleted')
      return props.loading ? t('aiChat.statusThinking') : ''
    }

    const { status, toolSteps, pendingApply } = props.streaming

    if (pendingApply) {
      const fileCount = pendingApply.files.length
      return t('aiChat.statusPendingApply', { count: fileCount })
    }

    if (status === 'error') {
      return t('aiChat.statusError')
    }

    if (status === 'cancelled') {
      return t('aiChat.statusCancelled')
    }

    // 查找正在运行的工具步骤
    const runningStep = toolSteps.find((s) => s.status === 'running')
    if (runningStep) {
      return t('aiChat.statusToolRunning', { label: runningStep.label })
    }

    if (status === 'streaming') {
      return t('aiChat.statusThinking')
    }

    if (status === 'completed') {
      return t('aiChat.statusCompleted')
    }

    return ''
  })

  /** 是否可见 */
  const visible = computed(() => {
    if (!props.streaming && !props.loading && !lastCompleted.value) return false
    if (isFadingOut.value) return false
    return statusText.value.length > 0
  })

  /** 状态样式类 */
  const statusClass = computed(() => {
    if (!props.streaming) {
      return lastCompleted.value ? 'status-completed' : 'status-idle'
    }
    const { status, pendingApply } = props.streaming
    if (pendingApply) return 'status-pending'
    if (status === 'error') return 'status-error'
    if (status === 'cancelled') return 'status-cancelled'
    if (status === 'completed') return 'status-completed'
    return 'status-active'
  })

  /** 指示点样式类 */
  const indicatorClass = computed(() => {
    if (!props.streaming) {
      return lastCompleted.value ? 'indicator-success' : 'indicator-idle'
    }
    const { status, pendingApply } = props.streaming
    if (pendingApply) return 'indicator-warning'
    if (status === 'error') return 'indicator-danger'
    if (status === 'cancelled') return 'indicator-idle'
    if (status === 'completed') return 'indicator-success'
    return 'indicator-accent'
  })

  /** 格式化的耗时 */
  const elapsedTime = computed(() => {
    if (elapsedSeconds.value <= 0) return ''
    if (elapsedSeconds.value < 60) {
      return `${elapsedSeconds.value}s`
    }
    const minutes = Math.floor(elapsedSeconds.value / 60)
    const seconds = elapsedSeconds.value % 60
    return `${minutes}m${seconds}s`
  })

  /** 开始计时 */
  function startTimer(): void {
    stopTimer()
    elapsedSeconds.value = 0
    timerInterval = setInterval(() => {
      elapsedSeconds.value++
    }, 1000)
  }

  /** 停止计时 */
  function stopTimer(): void {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
  }

  /** 完成后淡出 */
  function handleCompleted(): void {
    stopTimer()
    lastCompleted.value = true
    if (fadeOutTimer) {
      clearTimeout(fadeOutTimer)
    }
    fadeOutTimer = setTimeout(() => {
      isFadingOut.value = true
      // 淡出动画结束后清除 completed 标记
      setTimeout(() => {
        lastCompleted.value = false
        isFadingOut.value = false
      }, 300)
      fadeOutTimer = null
    }, 2000)
  }

  // 监听流式状态变化
  watch(
    () => props.streaming?.status,
    (newStatus, oldStatus) => {
      if (newStatus === 'streaming' && oldStatus !== 'streaming') {
        // 新对话开始,重置所有完成态标记
        isFadingOut.value = false
        lastCompleted.value = false
        startTimer()
      } else if (newStatus === 'completed') {
        handleCompleted()
      } else if (newStatus === 'error' || newStatus === 'cancelled') {
        lastCompleted.value = false
        stopTimer()
      }
    }
  )

  // 监听 streaming 对象本身:变为 null 时若刚完成,仍保留 lastCompleted 触发淡出
  watch(
    () => props.streaming,
    (newStreaming, oldStreaming) => {
      // streaming 从非 null 变 null,且上一次状态是 completed(已 handleCompleted),
      // lastCompleted 已为 true,无需额外处理,淡出计时器仍在运行。
      // 仅处理:从 null 变为有 streaming(新一轮开始)时确保 lastCompleted 复位
      if (newStreaming && !oldStreaming) {
        lastCompleted.value = false
        isFadingOut.value = false
      }
    }
  )

  // 监听 loading 状态
  watch(
    () => props.loading,
    (newLoading) => {
      if (newLoading) {
        isFadingOut.value = false
        startTimer()
      }
    }
  )

  onUnmounted(() => {
    stopTimer()
    if (fadeOutTimer) {
      clearTimeout(fadeOutTimer)
    }
  })
</script>

<style scoped>
  .agent-status-bar {
    display: flex;
    align-items: center;
    gap: var(--ui-space-sm);
    height: 28px;
    padding: 0 var(--ui-space-md);
    background: var(--ui-bg-nav-primary);
    border-bottom: 1px solid var(--ui-border-subtle);
    font-size: var(--ui-font-size-xs);
    color: var(--ui-text-secondary);
    transition: opacity 0.3s;
  }
  .status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .indicator-idle {
    background: var(--ui-text-tertiary);
  }
  .indicator-accent {
    background: var(--ui-accent);
    animation: breathe 1.6s ease-in-out infinite;
  }
  .indicator-warning {
    background: var(--ui-warning);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .indicator-danger {
    background: var(--ui-danger);
  }
  .indicator-success {
    background: var(--ui-success);
  }
  .status-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status-elapsed {
    color: var(--ui-text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  @keyframes breathe {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
  }
</style>

<!--
  @file CrashFeedbackModal.vue
  @description 崩溃反馈弹窗

  在 feedbackStore.isModalVisible 时展示当前崩溃报告(currentReport):
  - 头部:警告图标 + 标题 + 关闭按钮
  - 正文:描述 + 错误摘要(消息/时间/来源) + 可折叠详情(堆栈 + 主进程日志尾部)
  - 底部:复制 / 导出反馈文件 / 重载页面

  无 Props / Emits,状态由 feedbackStore 驱动。
-->

<template>
  <Teleport to="body">
    <Transition name="crash-modal-fade">
      <div
        v-if="feedbackStore.isModalVisible && report"
        class="crash-modal-overlay"
        @click.self="handleClose"
      >
        <div
          class="crash-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="crash-modal-title"
        >
          <div class="crash-modal__header">
            <span class="crash-modal__icon" aria-hidden="true">⚠</span>
            <span id="crash-modal-title" class="crash-modal__title">
              {{ t('feedback.title') }}
            </span>
            <button
              class="crash-modal__close"
              type="button"
              :title="t('feedback.closeButton')"
              :aria-label="t('feedback.closeButton')"
              @click="handleClose"
            >
              ×
            </button>
          </div>

          <div class="crash-modal__body">
            <p class="crash-modal__desc">{{ t('feedback.description') }}</p>

            <div class="crash-modal__summary">
              <div class="crash-modal__summary-row">
                <span class="crash-modal__summary-label">{{ t('feedback.errorLabel') }}</span>
                <span class="crash-modal__summary-value">{{ report.message }}</span>
              </div>
              <div class="crash-modal__summary-row">
                <span class="crash-modal__summary-label">{{ t('feedback.timeLabel') }}</span>
                <span class="crash-modal__summary-value">{{ formattedTime }}</span>
              </div>
              <div class="crash-modal__summary-row">
                <span class="crash-modal__summary-label">{{ t('feedback.sourceLabel') }}</span>
                <span class="crash-modal__summary-value">{{ sourceLabel }}</span>
              </div>
            </div>

            <button
              class="crash-modal__toggle"
              type="button"
              :aria-expanded="showDetails"
              @click="showDetails = !showDetails"
            >
              {{ showDetails ? t('feedback.hideDetails') : t('feedback.viewDetails') }}
            </button>

            <pre v-if="showDetails" class="crash-modal__details">{{ detailsText }}</pre>
          </div>

          <div class="crash-modal__footer">
            <button
              class="crash-modal__btn crash-modal__btn--secondary"
              type="button"
              @click="handleCopy"
            >
              {{ t('feedback.copyButton') }}
            </button>
            <button
              class="crash-modal__btn crash-modal__btn--primary"
              type="button"
              @click="handleExport"
            >
              {{ t('feedback.exportButton') }}
            </button>
            <button
              class="crash-modal__btn crash-modal__btn--secondary"
              type="button"
              @click="handleReload"
            >
              {{ t('feedback.reloadButton') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { storeToRefs } from 'pinia'
  import { useFeedbackStore } from '@/stores/feedbackStore'
  import { feedbackApi } from '@/core/capabilities/feedbackApi'
  import { logger } from '@/core/utils/logger'
  import type { CrashSource } from '@/types/feedback'

  const { t } = useI18n()
  const feedbackStore = useFeedbackStore()
  const { currentReport: report } = storeToRefs(feedbackStore)

  const showDetails = ref(false)
  const logTail = ref('')

  /** 详情区文本:错误堆栈 + (若存在)主进程日志尾部 */
  const detailsText = computed(() => {
    if (!report.value) return ''
    const parts: string[] = []
    parts.push(`${t('feedback.detailsStack')}:`)
    parts.push(report.value.stack ?? '(no stack)')
    if (logTail.value) {
      parts.push('')
      parts.push(`${t('feedback.detailsLog')}:`)
      parts.push(logTail.value)
    }
    return parts.join('\n')
  })

  /** 本地化时间显示 */
  const formattedTime = computed(() => {
    if (!report.value) return ''
    try {
      return new Date(report.value.timestamp).toLocaleString()
    } catch {
      return report.value.timestamp
    }
  })

  /** 按来源映射本地化文案 */
  const sourceLabel = computed(() => {
    const source = report.value?.source as CrashSource | undefined
    switch (source) {
      case 'renderer':
        return t('feedback.sourceRenderer')
      case 'main-process':
        return t('feedback.sourceMainProcess')
      case 'unhandled-rejection':
        return t('feedback.sourceUnhandledRejection')
      default:
        return source ?? ''
    }
  })

  /** report 变化时异步加载主进程日志尾部 */
  async function loadLogTail(): Promise<void> {
    if (!report.value) {
      logTail.value = ''
      return
    }
    try {
      logTail.value = await feedbackApi.readLogTail()
    } catch (e) {
      logger.error('[CrashFeedbackModal] 读取日志尾部失败:', e)
      logTail.value = ''
    }
  }

  // 报告变化时折叠详情并重新加载日志尾部
  watch(
    report,
    () => {
      showDetails.value = false
      void loadLogTail()
    },
    { immediate: true }
  )

  async function handleCopy(): Promise<void> {
    if (!detailsText.value) return
    try {
      await navigator.clipboard.writeText(detailsText.value)
      window.$toast?.success(t('feedback.copySuccess'))
    } catch (e) {
      logger.error('[CrashFeedbackModal] 复制失败:', e)
      window.$toast?.error(t('feedback.copyFailed'))
    }
  }

  async function handleExport(): Promise<void> {
    if (!report.value) return
    try {
      await feedbackApi.exportReport(report.value)
      window.$toast?.success(t('feedback.exportSuccess'))
    } catch (e) {
      logger.error('[CrashFeedbackModal] 导出失败:', e)
      window.$toast?.error(t('feedback.exportFailed'))
    }
  }

  function handleReload(): void {
    window.location.reload()
  }

  function handleClose(): void {
    feedbackStore.dismiss()
  }
</script>

<style scoped>
  .crash-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: var(--ui-overlay-backdrop-strong, rgba(15, 23, 42, 0.46));
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 20000;
    backdrop-filter: blur(4px);
  }

  .crash-modal {
    background: var(--ui-bg-elevated, #ffffff);
    width: 480px;
    max-width: 90%;
    max-height: 85vh;
    border-radius: var(--ui-radius-lg, 16px);
    box-shadow: var(--ui-shadow-lg, 0 12px 32px rgba(45, 55, 75, 0.08));
    border: 1px solid var(--ui-border, rgba(195, 208, 225, 0.82));
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: crash-modal-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .crash-modal__header {
    padding: 16px 24px;
    border-bottom: 1px solid var(--ui-border, rgba(195, 208, 225, 0.82));
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .crash-modal__icon {
    font-size: 22px;
    line-height: 1;
    color: var(--ui-warning, #f9c66b);
  }

  .crash-modal__title {
    flex: 1;
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--ui-text-title, var(--ui-text, #0f172a));
  }

  .crash-modal__close {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--ui-text-subtle, #8a97a8);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: color 0.2s;
  }

  .crash-modal__close:hover {
    color: var(--ui-text, #334155);
  }

  .crash-modal__body {
    padding: 20px 24px;
    overflow-y: auto;
  }

  .crash-modal__desc {
    margin: 0 0 16px;
    color: var(--ui-text-muted, #5e6c80);
    font-size: 14px;
    line-height: 1.6;
  }

  .crash-modal__summary {
    background: var(--ui-bg-base, rgba(246, 248, 252, 0.72));
    border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.72));
    border-radius: var(--ui-radius-md, 12px);
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .crash-modal__summary-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .crash-modal__summary-label {
    font-size: 12px;
    color: var(--ui-text-subtle, #8a97a8);
  }

  .crash-modal__summary-value {
    font-size: 14px;
    color: var(--ui-text, #334155);
    word-break: break-word;
  }

  .crash-modal__toggle {
    background: none;
    border: none;
    color: var(--ui-accent, #3aa0ff);
    cursor: pointer;
    padding: 0;
    font-size: 14px;
    font-weight: 500;
  }

  .crash-modal__toggle:hover {
    color: var(--ui-accent-hover, #268df0);
  }

  .crash-modal__details {
    margin: 12px 0 0;
    padding: 12px;
    background: var(--ui-bg-base, rgba(246, 248, 252, 0.72));
    border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.72));
    border-radius: var(--ui-radius-md, 12px);
    font-family: monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ui-text, #334155);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 260px;
    overflow-y: auto;
  }

  .crash-modal__footer {
    padding: 16px 24px;
    background-color: var(--ui-bg-panel, rgba(255, 255, 255, 0.72));
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    border-top: 1px solid var(--ui-border, rgba(195, 208, 225, 0.82));
  }

  .crash-modal__btn {
    height: 32px;
    padding: 0 16px;
    border-radius: var(--ui-radius-sm, 8px);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: 1px solid var(--ui-border, rgba(195, 208, 225, 0.82));
  }

  .crash-modal__btn:focus-visible {
    outline: none;
    box-shadow: var(--ui-shadow-focus, 0 0 0 3px var(--ui-accent-ring));
  }

  .crash-modal__btn--secondary {
    background: var(--ui-bg-elevated, #ffffff);
    color: var(--ui-text, #334155);
  }

  .crash-modal__btn--secondary:hover {
    background: var(--ui-bg-hover, rgba(255, 255, 255, 0.96));
    border-color: var(--ui-border-strong, rgba(165, 180, 200, 0.9));
  }

  .crash-modal__btn--primary {
    background: var(--ui-accent, #3aa0ff);
    color: var(--ui-text-on-accent, #ffffff);
    border-color: var(--ui-accent, #3aa0ff);
  }

  .crash-modal__btn--primary:hover {
    background: var(--ui-accent-hover, #268df0);
    border-color: var(--ui-accent-hover, #268df0);
  }

  .crash-modal-fade-enter-active,
  .crash-modal-fade-leave-active {
    transition: opacity 0.2s ease;
  }

  .crash-modal-fade-enter-from,
  .crash-modal-fade-leave-to {
    opacity: 0;
  }

  @keyframes crash-modal-slide-in {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
</style>

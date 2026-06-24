/**
 * @file feedbackStore.ts
 * @description 崩溃反馈状态管理(Pinia setup store)
 *
 * 职责:
 * - 接收捕获层提交的错误(ErrorInfo),补全环境字段构建 CrashReport
 * - 按错误指纹会话内去重,避免同一错误反复弹窗
 * - 维护待展示队列,控制 CrashFeedbackModal 显隐
 * - 异步持久化崩溃日志到 userData/feedback/(保底记录)
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CrashReport, ErrorInfo } from '@/types/feedback'
import { computeFingerprint } from '@/utils/crashFingerprint'
import { feedbackApi } from '@/core/capabilities/feedbackApi'
import { logger } from '@/core/utils/logger'

/** 生成简易 UUID(非加密用途,去重足够) */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/** 读取应用版本(运行时尽力获取) */
function readAppVersion(): string {
  try {
    return feedbackApi.getAppVersionSync()
  } catch {
    return 'unknown'
  }
}

/** 读取平台标识 */
function readPlatform(): string {
  if (typeof navigator !== 'undefined') {
    return navigator.platform || 'unknown'
  }
  return 'unknown'
}

export const useFeedbackStore = defineStore('feedback', () => {
  /** 待展示的崩溃报告队列 */
  const pendingReports = ref<CrashReport[]>([])
  /** 会话内已弹过的错误指纹(非响应式,重启清空) */
  const shownFingerprints = new Set<string>()

  /** 模态是否可见(队列非空即可见) */
  const isModalVisible = computed(() => pendingReports.value.length > 0)
  /** 当前展示的报告(队列首部) */
  const currentReport = computed(() => pendingReports.value[0])

  /**
   * 提交崩溃:补全环境字段、指纹去重后入队。
   * @param info 捕获层提交的原始错误信息
   */
  function reportCrash(info: ErrorInfo): void {
    // 防御:监听器内任何异常都不应再次抛出,避免二次崩溃
    try {
      const fingerprint = computeFingerprint(info.message, info.stack)
      if (shownFingerprints.has(fingerprint)) {
        return // 会话内去重
      }
      shownFingerprints.add(fingerprint)

      const report: CrashReport = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        source: info.source,
        fingerprint,
        message: info.message,
        stack: info.stack,
        appVersion: readAppVersion(),
        platform: readPlatform(),
        url: info.url,
        componentInfo: info.componentInfo,
      }
      pendingReports.value.push(report)
      // 异步持久化保底日志,不阻塞 UI
      void feedbackApi.persistCrashLog(report).catch((e) => {
        logger.warn('[feedbackStore] 持久化崩溃日志失败:', e)
      })
    } catch (e) {
      logger.error('[feedbackStore] reportCrash 内部异常:', e)
    }
  }

  /** 处理完当前报告,出列(下一个若有则继续显示) */
  function dismiss(): void {
    pendingReports.value.shift()
  }

  /** 应用启动时补弹渲染进程崩溃(pending-crash.json) */
  async function loadPendingFromMain(): Promise<void> {
    try {
      const pending = await feedbackApi.readPendingCrash()
      if (pending) {
        reportCrash({
          source: pending.source,
          message: pending.message,
        })
        feedbackApi.clearPendingCrash()
      }
    } catch (e) {
      logger.warn('[feedbackStore] 读取 pending crash 失败:', e)
    }
  }

  return {
    pendingReports,
    isModalVisible,
    currentReport,
    reportCrash,
    dismiss,
    loadPendingFromMain,
  }
})

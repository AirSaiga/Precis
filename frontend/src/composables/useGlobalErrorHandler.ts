/**
 * @file useGlobalErrorHandler.ts
 * @description 全局错误处理器安装
 *
 * 职责:
 * - 注册 Vue errorHandler + window error/unhandledrejection 三处监听
 * - 将未捕获错误转发给 feedbackStore(触发崩溃反馈窗口)
 * - 全部 try/catch 包裹,避免错误处理器自身抛出导致二次崩溃
 *
 * 调用时序:必须在 app.use(pinia) 之后、app.mount() 之前调用 installGlobalErrorHandler(app),
 *           保证 feedbackStore 在监听器首次触发时可正常初始化。
 */

import type { App } from 'vue'
import { getActivePinia } from 'pinia'
import { useFeedbackStore } from '@/stores/feedbackStore'
import { logger } from '@/core/utils/logger'
import type { ErrorInfo } from '@/types/feedback'

/**
 * 安装全局错误处理器。
 * @param app Vue 应用实例(pinia 已挂载)
 */
export function installGlobalErrorHandler(app: App): void {
  // 捕获 app 的 pinia 实例:错误处理器回调在事件循环中异步触发(非组件 setup 期间),
  // 此时 getActivePinia() 可能返回 null,导致 useFeedbackStore() 创建/取到错误的 store 实例。
  // 显式传入捕获的 pinia,保证回调里与组件用的是同一个 store 实例。
  const pinia = getActivePinia()

  /** 从捕获的 pinia 取 feedbackStore(回调安全) */
  const getStore = () => useFeedbackStore(pinia)

  // ① Vue 组件内未处理异常
  app.config.errorHandler = (err, _instance, info) => {
    try {
      const report: ErrorInfo = {
        source: 'renderer',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        componentInfo: info,
      }
      logger.error('[globalErrorHandler] Vue 异常:', err)
      getStore().reportCrash(report)
    } catch (e) {
      // 监听器内绝不再抛出,避免二次崩溃
      console.error('[globalErrorHandler] errorHandler 内部失败:', e)
    }
  }

  // ② window 原生 JS 错误
  // 区分脚本错误与资源加载错误:脚本错误才有 e.error(Error 对象),
  // 资源加载错误(图片/CSS)只有 e.target,不应作为崩溃上报
  window.addEventListener('error', (e) => {
    try {
      if (!e.error) return
      getStore().reportCrash({
        source: 'renderer',
        message: e.message,
        stack: e.error.stack,
        url: e.filename,
      })
    } catch (err) {
      console.error('[globalErrorHandler] window error 内部失败:', err)
    }
  })

  // ③ 未处理的 Promise rejection
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = e.reason
      getStore().reportCrash({
        source: 'unhandled-rejection',
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      })
    } catch (err) {
      console.error('[globalErrorHandler] unhandledrejection 内部失败:', err)
    }
  })
}

/**
 * @file useToast.ts
 * @description 统一的消息提示 Composable
 *
 * 该模块封装了应用全局的消息提示功能，
 * 消除各模块中重复的 Toast 消息实现。
 *
 * 功能：
 * 1. 提供 success, error, warning, info 四种消息类型
 * 2. 自动集成 i18n 国际化
 * 3. 降级处理：无 $toast 时使用 console 输出
 */

import { logger } from '@/core/utils/logger'
import { useI18n } from 'vue-i18n'

interface ToastAPI {
  success: (title: string, message: string) => void
  error: (title: string, message: string) => void
  warning: (title: string, message: string) => void
  info: (title: string, message: string) => void
}

declare global {
  interface Window {
    $toast?: ToastAPI
  }
}

export type ToastType = 'success' | 'error' | 'warning' | 'info'

/**
 * 统一的消息提示 Composable
 *
 * @returns 消息提示函数对象
 *
 * @example
 * ```typescript
 * const { success, error } = useToast()
 * success('操作成功', '文件已保存')
 * error('操作失败', error.message)
 * ```
 */
export function useToast() {
  const { t } = useI18n()

  const showToast = (type: ToastType, message: string, title?: string) => {
    const displayTitle = title || t(`common.${type}`)

    if (window.$toast) {
      window.$toast[type](displayTitle, message)
    } else {
      logger.debug(`[${type.toUpperCase()}] ${displayTitle}: ${message}`)
    }
  }

  return {
    success: (message: string, title?: string) => showToast('success', message, title),
    error: (message: string, title?: string) => showToast('error', message, title),
    warning: (message: string, title?: string) => showToast('warning', message, title),
    info: (message: string, title?: string) => showToast('info', message, title),
  }
}

/**
 * 检查 Toast API 是否可用
 */
export function isToastAvailable(): boolean {
  return !!window.$toast
}

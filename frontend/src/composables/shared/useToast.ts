/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Copyright 2026 Precis Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
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

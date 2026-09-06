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
 * @file feedback.ts
 * @description 键盘快捷键反馈
 *
 * 执行快捷键命令后展示 i18n 翻译后的 Toast 提示。
 */
import { i18n } from '@/i18n'

// window 上挂载的 Toast 句柄（由 Toast.vue 挂载）；交叉类型单断言即可取用
type ToastGlobal = Window & {
  $toast?: {
    info: (msg: string, detail: string) => void
    error: (msg: string, detail: string) => void
  }
}

/** 展示快捷键命令反馈（type='error' 时以错误级别提示，如命令执行异常） */
export function showFeedback(key: string, detail?: string, type?: 'info' | 'error'): void {
  const translatedText = i18n.global.t(key)
  const toast = (window as ToastGlobal).$toast
  if (typeof window !== 'undefined' && toast) {
    if (type === 'error') {
      toast.error(translatedText, detail || '')
    } else {
      toast.info(translatedText, detail || '')
    }
  }
}
